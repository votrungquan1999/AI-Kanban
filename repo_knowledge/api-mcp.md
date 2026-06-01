# Service & MCP Tool Surface

The contract is the **core service layer**; MCP re-exposes a subset to agent sessions. Authoritative design: [docs/design/mcp-api-contract.md](../docs/design/mcp-api-contract.md) (note: the design doc lists more tools than are built — the built reality is below).

## Core service functions (`src/cards/`)

| Function | File | Notes |
| --- | --- | --- |
| `createTask(input)` | `card.service.ts` | forces `todo`, assigns `number`, defaults runtime fields, emits create audit row. Uses `insertOne(..., { ignoreUndefined: true })` so an omitted `description` is absent (not BSON null). E11000 → `ERR_DUPLICATE`. |
| `getTask(id)` | `card.service.ts` | parse-on-read; unknown id → `ERR_NOT_FOUND`. |
| `listTasks(filter?)` | `card.service.ts` | sorted `{ priority: -1, createdAt: 1 }`; optional status filter. |
| `updateTaskStatus(id, status, {caller})` | `card.service.ts` | atomic move enforcing the transition policy; emits success/failure audit row. |
| `claimCard(id)` | `card.claim.service.ts` | dedicated atomic `todo → in_progress` (see below). |
| `setWorkspace(id, declaration)` | `card.workspace.service.ts` | idempotent PUT of `{workspacePath, repos[]}`. |
| `emitCardEvent` / `listCardEvents` | `card-event.service.ts` | audit log write / chronological read. |
| `nextNumber(db)` | `counters.ts` | monotonic id. |

### Why `claimCard` is separate from `updateTaskStatus`

`todo → in_progress` is **not a legal edge for non-UI callers** in the transition policy, so the claim cannot route through `updateTaskStatus`. It is a dedicated atomic op. The single filtered `findOneAndUpdate` is the no-double-assignment guarantee — no lease, no `claimedBy`.

## Status transition policy (`src/cards/transition-policy.ts`)

Enforced inside `updateTaskStatus` by filtering the update on legal source statuses (`$in`) per caller — an illegal move matches nothing, then a pre-image read disambiguates NotFound vs InvalidTransition.

- **`Caller.Ui`** → **any → any** (the human escape hatch / drag). The web UI always passes `Caller.Ui`.
- **`Caller.Agent`** → only its lifecycle edges: `in_progress→need_review`, `in_progress→done`, `need_review→in_progress`, `need_review→done`.
- **`Caller.Scheduler`** → no agent-exposed edge in the current slice (the design-only scheduler would claim via `claimCard`, not this).

## MCP servers (`src/mcp/`)

Two builders; both map domain `AppError`s to tool results via `appErrorToToolResult` (embeds the `ERR_*` code in text + structured content so the agent can react) and successes via `toCardResult`.

### Generic dispatch server (active — `dispatch-server.ts` / `dispatch-tools.ts`)
No identity, id is a runtime argument:
- `claim_card(id)` → `claimCard`; an unclaimable card returns a **readable error result** (missing and already-claimed are deliberately indistinguishable), not a throw.
- `get_card_context(id)` → `getTask`.
- `set_status(id, status)` → `updateTaskStatus` as `Caller.Agent`.
- `set_workspace(id, {workspacePath, repos})` → `setWorkspace`. **Gotcha: PUT semantics** — the agent must send the *full* repo set each call or it wipes the others.

The tool set is registered by a single `registerDispatchTools(server)` (`dispatch-server.ts`) so it is **shared across transports** (the stdio factory and the HTTP route both call it — one source of truth for the four tools).

**Two transports for the same dispatch server:**
- **stdio** — `src/mcp/dispatch-index.ts` (reads no env; for a locally-spawned session).
- **remote HTTP (Streamable HTTP)** — `app/api/mcp/route.ts` (`POST /api/mcp`), built with `createMcpHandler` from `mcp-handler` (`runtime = "nodejs"`, `disableSse: true`). This is the **phone/remote path**: a Claude Code session anywhere connects to the deployed URL. The route gates every request on **HTTP Basic auth** (`MCP_BASIC_USER` / `MCP_BASIC_PASS`) using a **constant-time** comparison (`timingSafeEqual`, length-guarded so a mismatch is a clean 401 not a 500); an unauthenticated request gets `401` + `WWW-Authenticate: Basic` and **no tool runs**. A single shared credential gates the whole session pool.

### Card-scoped server (retained — `server.ts` / `tools.ts`)
Bound to a single `CARD_ID`:
- `get_my_task()` → `getTask(CARD_ID)`.
- `set_my_status(status)` → `updateTaskStatus(CARD_ID, …, Caller.Agent)`.

Entry: `src/mcp/index.ts` — reads + validates `CARD_ID` from env at startup (fail-fast). Both entries auto-run only when executed directly (`process.argv[1] === fileURLToPath(import.meta.url)`), so importing them in tests is side-effect-free and never opens stdio.

## Error model (`src/cards/errors.ts`)

`AppError` carries a stable `ErrorCode` enum. Built codes: `ERR_VALIDATION`, `ERR_DUPLICATE`, `ERR_NOT_FOUND`, `ERR_INVALID_TRANSITION`, `ERR_SCHEMA_DRIFT`. (The design doc mentions `ERR_FORBIDDEN`/`ERR_REPO_*`; these were **dropped** by the pool-dispatch revision — no lease, and `set_workspace` is idempotent so there is no "already added" case.)

## Validation boundary

Inputs are parsed with shared Zod schemas (`src/cards/card.schema.ts`) at the service boundary — the **one intentional** parse point (the project's "no defensive try/catch" rule). `createTaskInputSchema` is the single source of truth shared by the web form and the service.
