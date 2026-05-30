# Next Actions — backlog

Concrete, ready-to-pick work items surfaced during development. Each item lists
**why**, **what**, and rough **acceptance criteria** so it can drop straight into
the feature-development plan.

Parent: [design README](./README.md).

> **Status:** all three items below were **implemented in Slice 3** (hygiene +
> parse-on-read + audit log) — see [IMPLEMENTATION_PROGRESS.md](../../IMPLEMENTATION_PROGRESS.md).
> They are kept here (marked ✅) as the record of why each was done and where it
> landed. The one remaining open thread is the **failure-event timeline UI** noted
> under item 2.

---

## 1. Engineering hygiene (cheap, immediate payoff)

These enforce conventions that are currently only checked by the editor, and stop
regressions before they land.

### 1a. Add Biome (linter + formatter) — ✅ Done

**Landed:** `biome.json` (Biome 2.4.16: 2-space, double quotes, v2
`assist.actions.source.organizeImports`, `noUnusedImports=error`, CSS excluded,
a11y relaxed for vendored `src/components/ui/**`); `lint`/`format` scripts.

**Why:** The project's conventions — import ordering, individual exports (no
`export { A, B }` barrels), no unused imports — are real rules
(`.claude/rules/typescript-imports-exports.md`) but nothing enforces them outside
the IDE. Throughout development the editor flagged *"imports and exports are not
sorted"* and unused-import warnings that a CI check never saw.

**What:**
- `npm install -D @biomejs/biome` (never hand-edit `package.json`).
- Add `biome.json` configured for: import organizing, no-unused-imports,
  formatter (match the existing 2-space style). Tune rules so they reflect the
  `.claude/rules` conventions rather than Biome defaults where they differ.
- Add scripts: `"lint": "biome check ."` and `"format": "biome format --write ."`.
- Run once across the repo and fix the existing import-order / unused warnings.

**AC:** `npm run lint` passes clean on the whole repo; running it would FAIL on an
unsorted import or unused symbol (verify by introducing one, then reverting).

### 1b. Add GitHub Actions CI — ✅ Done

**Landed:** `.github/workflows/ci.yml` (push/PR to `main`:
`npm ci → npm run lint → npx tsc --noEmit → npm run test:run`, mongodb-binaries
cached) + `.nvmrc` pinned to Node `26`.

**Why:** `tsc`, tests, and (now) lint all run by hand. Once an autonomous loop is
mutating data, a regression gate matters even more. Repo: `votrungquan1999/AI-Kanban`.

**What:**
- `.github/workflows/ci.yml` running on PR + push to the default branch:
  `npm ci` → `biome check .` → `tsc --noEmit` → `vitest run`.
- Node version pinned to match local. The Mongo tests use
  `mongodb-memory-server` (no external service needed in CI).

**AC:** A PR with a type error, a lint violation, or a failing test is shown as a
failed check; a clean PR is green.

---

## 2. Audit / event log — ✅ Done (timeline UI still open)

**Landed:** the `card_events` collection + `cardEventsCollection` accessor +
`{ cardId: 1, at: 1 }` index; `CardEventDocument`/`EventOutcome`;
`src/cards/card-event.service.ts` (`emitCardEvent` + `listCardEvents`). Events emit
on create + successful + rejected transitions with the `outcome`/`error`
discriminator. See [data-model.md](./data-model.md#card_events-implemented).
**Still open:** the card-detail **timeline UI** (grey out / filter failures, surface
`error` detail) — noted under "Future UI" below.

**Why:** A status change currently leaves no trace of **who** moved a card
(UI vs agent vs scheduler), **when**, or **why**. This is needed for (a)
debuggability of the autonomous loop and (b) the phone review surface, which wants
a **timeline of what the agent did** — directly serving the Need-Review handoff.

**What (locked for the implementation slice):**
- A separate `card_events` collection (append-only), NOT embedded history. Each
  event: `cardId`, `from` (`Status | null` — `null` for create), `to` (`Status`),
  `caller` (the `Caller` enum: `ui` / `agent` / `scheduler`), `at` (timestamp),
  `outcome` (`success` | `failure`), and `error` (`{ code, message } | null` —
  populated only on a `failure`). `reason` / `message` free-text fields are NOT
  added this slice.
- **Why `outcome` + `error`:** the bare `{cardId, from, to, caller, at}` shape can't
  tell a rejected move apart from a successful one. `outcome` makes failures
  distinguishable; `error` captures the `ErrorCode` + message of a rejected
  transition (e.g. `ERR_INVALID_TRANSITION`, `ERR_NOT_FOUND`) for developer
  investigation. The `outcome` flag also disentangles a `failure` with `from = null`
  (a NotFound on a phantom card) from a `success` create with `from = null`.
- Emit from the single choke points: `createTask` (create, `success`),
  `updateTaskStatus` on a successful transition (`success`), and `updateTaskStatus`
  on a rejected transition (`failure`, with the `error` detail). Both
  InvalidTransition and NotFound emit a `failure` event.
- A `{ cardId: 1, at: 1 }` index supports chronological read-back per card.

**Future UI (note, not this slice):** surface the per-card event timeline in the
card detail view (web UI / phone review surface). When displaying, **grey out
failed (`outcome: failure`) transitions** or let the user **filter to just failures**
so they can drill into the stored `error.code` / `error.message` — this is the
developer/debug view of why an autonomous move was rejected.

**AC (implementation slice):** A create writes one `success` event (`from = null`,
`to = todo`); every successful transition writes one `success` event carrying
`caller` + `from→to`; every rejected transition writes one `failure` event carrying
the attempted `to` + the `error` code/message; the events for a card read back in
chronological order. Relates to: [mcp-api-contract.md](./mcp-api-contract.md)
(transition policy), [scheduler-runner.md](./scheduler-runner.md),
[web-ui.md](./web-ui.md) (card detail timeline).

---

## 3. Parse-on-read DB wrapper (`findOneZ` & friends) — ✅ Done

**Landed:** `src/db/find-z.ts` (`findOneZ`/`findManyZ`/`findOneAndUpdateZ` over a
shared `parseOrThrow` — log + throw `AppError(ERR_SCHEMA_DRIFT)` on drift, `null`
unparsed on absent); `cardDocumentSchema` + `cardEventDocumentSchema`;
`getTask`/`listTasks`/`updateTaskStatus` read-back migrated (miss-path read left
raw). See [data-model.md](./data-model.md#data-access-layer-decided).

**Why:** The read path currently trusts the raw document shape — there is no
validation coming **out** of Mongo. The `ignoreUndefined` bug (an omitted
`description` persisted as BSON `null`, diverging from `Card.description?`) was
exactly this class of drift, caught only by a downstream deep-equal. As the schema
grows, a parse-on-read layer catches drift at the boundary, the same way Zod
catches it on the way in.

**What (design sketch — refine when picked):**
- A thin wrapper layer over the typed collection methods in `src/db/` that takes a
  Zod schema and validates the returned document(s):
  - `findOneZ(collection, filter, schema)` → parsed doc or `null`.
  - `findManyZ(...)` / a cursor-to-array variant → `parse` each doc.
  - Consider a `findOneAndUpdateZ(...)` for the atomic update paths.
- Define the missing **document** schemas (e.g. `cardDocumentSchema`) to validate
  against — pairs with the existing client `Card` schema/types.
- A parse failure is a clear, surfaced error (schema drift / bad data), not a
  silent pass — this is an intentional boundary, so the one `try`/parse there is
  allowed under the error-handling rule.
- Migrate `getTask`, `listTasks`, and the `findOneAndUpdate` read-back in
  `updateTaskStatus` onto the wrappers.

**AC:** Reading a document whose shape violates the schema throws a validation
error (verify with a deliberately malformed seeded doc); valid reads return the
typed, parsed document unchanged. Existing service tests stay green after migration.
Relates to: [data-model.md](./data-model.md), `src/db/`, `src/cards/card.schema.ts`.
