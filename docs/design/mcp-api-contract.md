# MCP / API Contract

> The tool surface that moves cards around the board. Borrowed shape from Vibe Kanban (`list_tasks`/`create_task`/`update_task_status`), extended for our session + multi-repo-workspace model.
> Parent: [design README](./README.md) · data shapes: [data-model.md](./data-model.md)

---

## Two surfaces over one service

All tools are thin wrappers over a single **core service layer** (TS functions that talk to MongoDB via the native driver + Zod). The service is exposed two ways:

1. **MCP server** — connected to each running Claude Code session. **Scoped to that session's card** (see [Agent scoping](#agent-scoping-least-privilege)). This is how the agent reads its assignment and moves its own card.
2. **Internal callers** — the **scheduler**, **runner**, and **web UI** call the service layer directly (in-process), not over MCP.

```
 Web UI ─┐
Scheduler ├─▶ core service ──▶ MongoDB
 Runner ─┘        ▲
                  │ (MCP, scoped to CARD_ID)
          Claude Code session (agent)
```

So "the contract" is really one set of service functions; the MCP server re-exposes a safe, card-scoped subset to the agent.

---

## Tool roster

| Tool | Exposed to agent (MCP)? | Internal callers | Purpose |
| ---- | ----------------------- | ---------------- | ------- |
| `list_tasks(filter?)` | ✗ (default) | scheduler, UI | scan board by status |
| `get_task(id)` | ✓ (own card only) | UI | read a card |
| `create_task(input)` | ✗ | scheduler, UI | new Todo card |
| `update_task_status(id, status)` | ✓ (own card only) | scheduler | move a card |
| `set_session_url(id, session)` | ✗ | runner | attach claude.ai link |
| `add_repo_to_workspace(id, repo)` | ✓ (own card only) | runner | create a worktree for a confirmed repo |

Agent gets exactly three: read its card, move its card, add a confirmed repo. Everything that creates cards or attaches sessions is **runner/scheduler-only** — the agent can't spawn work or forge session links.

---

## Agent scoping (least privilege)

The MCP server launched for a session is **parameterized with that session's `CARD_ID`** (the card `_id`, injected as env var at spawn). The agent-facing tools are **implicitly scoped** to it:

- They ignore/omit the `id` argument and always act on `CARD_ID`, **or** they accept `id` and **reject** any call where `id !== CARD_ID` (`ERR_FORBIDDEN`).
- Net effect: an agent can only ever read/move **its own** card and add repos to **its own** workspace — never touch another card.

Recommended agent-facing names make the scoping obvious: `get_my_task()`, `set_my_status(status)`, `add_repo_to_my_workspace(repo)`. (Internally they map to the same service functions with `CARD_ID` bound.)

---

## Per-tool contracts

Input/output shapes are Zod schemas (shared with the data layer). `CardId = z.string().regex(/^[a-f0-9]{24}$/)` (ObjectId hex). `Status = z.enum(["todo","in_progress","need_review","done"])`.

### `list_tasks(filter?)` — scheduler, UI

```ts
input:  { status?: Status, origin?: "manual" | "recurring", limit?: number }
output: Card[]   // sorted by priority desc, then createdAt asc
```

Used for board column reads and Todo scanning. Not given to the agent by default (no need; least privilege). Backed by the `{ status, priority, createdAt }` index.

### `get_task(id)` — agent (own), UI

```ts
input:  { id: CardId }
output: Card
errors: ERR_NOT_FOUND, ERR_FORBIDDEN (agent: id !== CARD_ID)
```

The agent calls this first (`get_my_task()`) to read its assignment from the board — the board **is** the task queue (no prompt injection).

### `create_task(input)` — scheduler, UI

```ts
input: {
  title: string,
  description?: string,
  priority?: number,            // default 0
  origin: { type: "manual" } | { type: "recurring", defId: CardId },
  dedupeKey?: string,           // recurring intake; enforced by partial unique index
}
output: Card                    // status forced to "todo"; number assigned via counters
errors: ERR_DUPLICATE (dedupeKey already on an open card)
```

`ERR_DUPLICATE` is the dedupe signal for Flow 1 (duplicate-key on the partial unique index → "already queued", not a failure).

### `update_task_status(id, status)` — scheduler, agent (own)

```ts
input:  { id: CardId, status: Status }
output: Card
errors: ERR_NOT_FOUND, ERR_FORBIDDEN, ERR_INVALID_TRANSITION
```

Single-doc atomic update. Sets `pickedAt` on first → `in_progress`, `finishedAt` on → `done`, always bumps `updatedAt`. Enforces the [transition policy](#status-transition-policy).

### `set_session_url(id, session)` — runner only

```ts
input:  { id: CardId, session: { id: string, url: string } }
output: Card
errors: ERR_NOT_FOUND
```

Called by the runner right after spawning Remote Control, with the scraped `https://claude.ai/code/...` URL. Not agent-exposed — the agent can't forge its own review link.

### `add_repo_to_workspace(id, repo)` — agent (own), runner

```ts
input:  { id: CardId, repo: string }   // repo = sibling dir name under the parent
output: { repo: string, branch: string, worktreePath: string }   // the pushed repos[] entry
errors: ERR_NOT_FOUND, ERR_FORBIDDEN, ERR_REPO_NOT_FOUND, ERR_REPO_ALREADY_ADDED
```

Side effect: runner runs `git -C <parent>/<repo> worktree add workspaces/card-<number>/<repo> -b aikanban/card-<number>`, then `$push`es the entry into the card's `repos[]`. This is the on-demand worktree creation after the user confirms repos (see workspace flow in the architecture doc). Idempotent per repo (`ERR_REPO_ALREADY_ADDED` if already present).

---

## Status transition policy

Not every move is legal. Enforced in `update_task_status`:

| From → To | Allowed caller | Meaning |
| --------- | -------------- | ------- |
| `todo → in_progress` | scheduler | atomic pickup/claim |
| `in_progress → need_review` | agent | pause for human (review or a question) |
| `in_progress → done` | agent | confident completion |
| `need_review → in_progress` | agent | resume after human reply |
| `need_review → done` | agent | human accepted |
| any → any | **UI only** | manual override / drag (human escape hatch) |

Anything else → `ERR_INVALID_TRANSITION`. The UI (human) can override freely; programmatic callers are constrained.

---

## Validation & errors

- **Validation:** every input parsed with its Zod schema at the service boundary; a parse failure → `ERR_VALIDATION` with the Zod issue list. (Per project rules, no defensive try/catch — validation is the one intentional boundary.)
- **Error model:** structured `{ code, message }`. For MCP, errors surface as tool-call errors so the agent can read and react (e.g. retry `add_repo_to_workspace` with a different name on `ERR_REPO_NOT_FOUND`).

Error codes: `ERR_VALIDATION`, `ERR_NOT_FOUND`, `ERR_FORBIDDEN`, `ERR_INVALID_TRANSITION`, `ERR_DUPLICATE`, `ERR_REPO_NOT_FOUND`, `ERR_REPO_ALREADY_ADDED`.

---

## Open questions

1. **MCP transport** for the session→board connection: stdio (board MCP launched per session) vs. a long-lived HTTP/SSE MCP server the session connects to. HTTP fits the "one board, many sessions" model better — confirm against how Remote Control sessions attach MCP servers.
2. **Does the agent ever need `list_tasks`?** Default no (least privilege). Revisit if a task legitimately needs cross-card awareness.
3. **Web UI transport** (tRPC vs REST) — out of scope for this doc; the service layer is transport-agnostic.
