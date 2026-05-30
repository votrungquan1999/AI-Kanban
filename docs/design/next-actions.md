# Next Actions — backlog

Concrete, ready-to-pick work items surfaced during development. Not yet scheduled
into a slice — pick when ready. Each item lists **why**, **what**, and rough
**acceptance criteria** so it can drop straight into the feature-development plan.

Parent: [design README](./README.md).

---

## 1. Engineering hygiene (cheap, immediate payoff)

These enforce conventions that are currently only checked by the editor, and stop
regressions before they land.

### 1a. Add Biome (linter + formatter)

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

### 1b. Add GitHub Actions CI

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

## 2. Audit / event log

**Why:** A status change currently leaves no trace of **who** moved a card
(UI vs agent vs scheduler), **when**, or **why**. This is needed for (a)
debuggability of the autonomous loop and (b) the phone review surface, which wants
a **timeline of what the agent did** — directly serving the Need-Review handoff.

**What (design sketch — refine when picked):**
- A `card_events` collection (append-only), or an embedded capped history on the
  card. Each event: `cardId`, `from`, `to` (status), `caller` (the
  `Caller` enum: `ui` / `agent` / `scheduler`), `at` (timestamp), optional
  `reason` / `message`.
- Emit an event from `updateTaskStatus` on every successful transition (the single
  choke point already exists). Consider also emitting create/error events.
- Surface the timeline in the card detail view (later, in the web UI / review
  surface).

**AC:** Every successful status transition writes exactly one event carrying the
caller and from→to; the events for a card can be read back in chronological order.
Relates to: [mcp-api-contract.md](./mcp-api-contract.md) (transition policy),
[scheduler-runner.md](./scheduler-runner.md), [web-ui.md](./web-ui.md) (card detail).

---

## 3. Parse-on-read DB wrapper (`findOneZ` & friends)

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
