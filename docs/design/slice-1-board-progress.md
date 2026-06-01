# Implementation Progress: AI Kanban — First Vertical Slice

Plan: [implementation-plan.md](./implementation-plan.md) · Steps: [PLAN_STEPS.md](./PLAN_STEPS.md)

Resolved stack (newer than plan assumed): **Next 16 · React 19 · Tailwind v4 · Zod 4 · Vitest 4 · mongodb 7 · mongodb-memory-server 11**. Adaptation: Tailwind v4 uses `@tailwindcss/postcss` + `@import "tailwindcss"` (no content-globs config). Vitest: default env `node`; component tests opt into jsdom via `// @vitest-environment jsdom` pragma. `package.json` is `type: module`.

---

### Step 0: Scaffolding & tooling

**Status:** ✅ Done

**Validation:** 1 sanity Vitest test passing ✅ (`src/sanity.test.ts`).

**Notes:** Installed runtime + tooling deps via `npm install`. Created `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx` (placeholder), `vitest.config.ts`, `vitest.setup.ts`, npm scripts. mongodb-memory-server global setup deferred to Step 1 (built when first test needs it).

### Step 1: Cached Mongo connection helper

**Status:** ✅ Done

**Tests (1 passing ✅):** 1. `getDb` returns the same cached Db across calls.

**Notes:** `src/db/mongo.ts` — module-level cache + shared in-flight connect promise (survives hot-reload), `closeMongo()` for teardown. Integration test boots a per-file `mongodb-memory-server` in `beforeAll`. `@/` alias confirmed working.

### Step 2: Card Zod schemas + inferred types

**Status:** ✅ Done

**Tests (2 passing ✅):** 1. valid manual input parses + priority defaults to 0; 2. rejects invalid input (missing title / bad origin / bad status / bad id).

**Notes:** `src/cards/card.type.ts` (Status/OriginType/RunState enums, `CardDocument`, client `Card`, origin types); `src/cards/card.schema.ts` (`createTaskInputSchema`, `statusSchema`, `originSchema` discriminated union, `cardIdSchema` 24-hex). Zod 4 `z.enum(NativeEnum)` works.

### Step 3: Index bootstrap

**Status:** ✅ Done

**Tests (1 passing ✅):** 1. creates the 3 cards indexes (composite, unique `number`, partial-unique `dedupeKey`) and is idempotent.

**Notes:** `src/db/collections.ts` (typed `cards`/`counters` accessors + `CounterDocument`), `src/db/indexes.ts` (`bootstrapIndexes`).

### Step 4: nextNumber (monotonic card number)

**Status:** ✅ Done

**Tests (2 passing ✅):** 1. sequential 1,2,3; 2. no duplicates under concurrency (25 parallel).

**Notes:** `src/cards/counters.ts` — atomic `$inc` upsert on `{_id:"cards"}`. Extracted `src/test/use-test-mongo.ts` helper (rule-of-3) and refactored mongo/indexes tests onto it.

---

**Quality checkpoint (data layer, Steps 1–4):** full suite 7/7 green. Quality-gate **PASS** (2 import-order fixes). Committed `b321376`.

### Step 5: createTask

**Status:** ✅ Done

**Tests (3 passing ✅):** 1. persists todo card w/ number + defaults; 2. duplicate open dedupeKey → ERR_DUPLICATE; 3. multiple manual null-dedupeKey cards allowed.

**Notes:** `src/cards/errors.ts` (AppError + ErrorCode enum), `src/cards/card.mapper.ts` (doc→client), `card.service.ts` createTask. **Bug fix:** dedupeKey partial index now filters `dedupeKey: {$type:"string"}` so null-dedupe manual cards don't collide. `CreateTaskInput` switched to `z.input`.

### Step 6: listTasks

**Status:** ✅ Done

**Tests (2 passing ✅):** 1. sorted priority desc then createdAt asc; 2. filters by status + returns clean client objects (no `_id`).

**Notes:** `listTasks(filter?)` in card.service.ts; sort `{priority:-1, createdAt:1}`.

### Step 7: updateTaskStatus

**Status:** ✅ Done

**Tests (2 passing ✅):** 1. any→any move (UI) sets pickedAt (first in_progress) + finishedAt (done) + bumps updatedAt, preserves pickedAt; 2. unknown id → ERR_NOT_FOUND.

**Notes:** `src/cards/transition-policy.ts` (Caller enum + `canTransition` seam — UI any→any). Atomic aggregation-pipeline `findOneAndUpdate` with `$ifNull`/`$$NOW` for conditional timestamps.

---

**Quality checkpoint (service layer, Steps 5–7):** full suite 14/14 green. Quality-gate **PASS** (1 import-order fix). Committed `d05f865`.

### Step 8: Board page (4 columns, Server Component)

**Status:** ✅ Done

**Tests (1 passing ✅):** 1. `Board` renders the four columns and their cards.

**Notes:** `app/(board)/`: `board.type.ts`, `board.columns.ts` (groupIntoColumns), `card.ui.tsx`, `column.ui.tsx`, `board-layout.ui.tsx`, `board.tsx` (composition), `board-shell.ui.tsx`; `app/page.tsx` reads `listTasks` and renders. Styling kept in `*.ui.tsx` per server-components-rules §2.

### Step 9: Add-task dialog + Server Action

**Status:** ✅ Done

**Tests (2 passing ✅):** 1. renders nothing when closed; 2. submits + shows the action's validation error.

**Notes:** `actions.ts` (`createTaskAction`, shared Zod validation → create → revalidate → redirect), `add-task-dialog.tsx` (action injected as prop for testability + to avoid server-only imports), `add-task-form.ui.tsx`, `add-task.type.ts`, `href.ts`. Dialog open state via `?new=task` URL param read in `page.tsx`.

### Step 10: Drag-to-move (optimistic UI)

**Status:** ✅ Done

**Tests (1 passing ✅):** 1. `applyOptimisticMove` moves a card to the target column + updates status (pure logic). Drag interaction itself validated via this pure fn + tested `updateTaskStatus` + `useOptimistic` framework revert (full drag E2E deferred — needs Playwright, not jsdom).

**Notes:** `board.move.ts` (pure optimistic move), `board.tsx` now client (`useOptimistic` + dnd-kit `DndContext`), `draggable-card.ui.tsx` / `droppable-column.ui.tsx` wrappers, `moveCard` action. `moveAction` injected as prop so `board.tsx` has no Mongo imports.

---

**Quality checkpoint (UI layer, Steps 8–10):** full suite 18/18 green; `tsc --noEmit` clean. Quality-gate **PASS** (layout.tsx import-order + JSDoc fixed). Committed `1c27ddc`.

---

## shadcn/ui + design tokens — RESOLVED ✅ (2026-05-30)

Stood up the shadcn/ui + Tailwind-token foundation and refactored the board's `.ui` layer to comply. Both previously-flagged deviations are now cleared.

- `shadcn init` (Base UI-based build) → `components.json`, `src/lib/utils.ts` (`cn`), token layer in `app/globals.css` (oklch `--primary`/`--card`/`--muted`/`--destructive`/… + `.dark`).
- Added shadcn components: `button`, `dialog`, `input`, `card`, `label` (in `src/components/ui/`).
- Refactored: `card.ui` → shadcn `Card`; `add-task-form.ui` → shadcn `Input`/`Label`/`Button`/`DialogClose`; `add-task-dialog` → shadcn `Dialog` (controlled by `open`, closes via `router.replace` → strips `?new=task`); `board-shell.ui` → shadcn `Button` link; columns/layout → `grid`; all colors tokenized (`bg-background`, `text-muted-foreground`, `text-destructive`, `bg-muted`…); no fixed palette / no `absolute` in board code (overlay handled by shadcn Dialog).
- Dialog test now mocks `next/navigation`. **18/18 tests still green; `tsc --noEmit` clean.**

## Known rule-deviations (RESOLVED — kept for history)

These are NOT in the slice plan/scaffolding and require a project-wide foundation:

1. **shadcn/ui** (`component-library.md`): the slice uses plain `<form>/<button>/<input>` and a custom dialog/overlay instead of shadcn `Dialog/Button/Input/Card`. shadcn was never initialized (no `components.json`, no `src/components/ui/`, no `cn`).
2. **Tailwind tokens/layout** (`tailwind-basics.md`): `.ui` files use fixed palette (`bg-gray-50`, `text-red-600`, `bg-black/30`), `flex`, `w-72`, and `fixed inset-0` instead of tokenized colors (`bg-primary`…), `grid`, `size-*`, and `pile`. Tokenized colors require a theme/token layer (part of shadcn init) that doesn't exist yet.

Both depend on standing up a shadcn + design-token foundation — recommend a dedicated follow-up step. Functional behavior is complete, tested (18/18), and type-clean regardless.

---

## Final status — slice COMPLETE ✅

- **Steps 0–10:** all ✅ Done.
- **Tests:** 18 passing across 9 files (Vitest + mongodb-memory-server). `npx tsc --noEmit` clean (0 errors).
- **Quality gates:** data / service / UI layers all PASS.
- **Validation (independent):** all steps VALID; Step 10 valid-with-caveats (drag-gesture + revert-on-error path deferred to Playwright — jsdom can't drive dnd-kit).
- **Commits:** `45038b6` scaffold · `b321376` data layer · `d05f865` service layer · `1c27ddc` UI layer.

**Follow-ups (recommended, not blockers):**
1. shadcn/ui + design-token foundation, then refactor `.ui` components to shadcn + tokenized colors / `grid` / `size-*` / `pile` (see Known rule-deviations).
2. Playwright E2E for the drag-to-move gesture + optimistic revert.
3. Set `MONGODB_URI` (+ optional `MONGODB_DB`) env before running `next dev` — the board page reads Mongo at request time.
4. Optional: add a lint tool (biome/eslint) to enforce the import-ordering convention in CI (currently editor-only).

---

# Slice 2: MCP Server (card-scoped agent tools over stdio)

Plan: [PLAN_STEPS.md](./PLAN_STEPS.md) · Research: [RESEARCH_OUTPUT.md](./RESEARCH_OUTPUT.md)
Scope: stdio transport, one server per session (CARD_ID env-injected). Two agent tools, no `id` arg: `get_my_task`, `set_my_status`. SDK `@modelcontextprotocol/sdk@1.29.0` (already in node_modules). Errors RETURNED (isError:true) so the agent reads ERR_* codes.

### Step 1: getTask(id) returns client-facing card

**Status:** ✅ Done
**Test Result:** red → green

**Files Changed:**
- `src/cards/card.service.ts`: added `getTask(id)` (validates via `cardIdSchema`, `findOne`, throws `ERR_NOT_FOUND` on null, maps via `toClientCard`); added `cardIdSchema` import.
- `src/cards/card.service.ts`: `createTask` insert now uses `{ ignoreUndefined: true }` — root-cause fix for a discovered inconsistency (omitted `description` was serialized to BSON null on insert, so reads returned `null`, violating `Card.description?: string` and diverging from `createTask`'s own return).
- `src/cards/card.service.test.ts`: new `describe("getTask")` happy-path test.

**Regressions:** none (8/8 in the file pass).
**Notes:** The `ignoreUndefined` fix keeps create/read consistent and the client type sound — surfaced by the deep-equal assertion, exactly the kind of inconsistency the prior dedupeKey/null bug taught us to watch for.

### Step 2: getTask(unknown) → ERR_NOT_FOUND

**Status:** ✅ Done
**Test Result:** green on first run (throw implemented in Step 1; this test validates it)

**Files Changed:**
- `src/cards/card.service.test.ts`: added the not-found test to `describe("getTask")`.

**Regressions:** none.

### Step 3: (caller, to) transition matrix — `legalFromStatuses`

**Status:** ✅ Done
**Test Result:** red → green

**Files Changed:**
- `src/cards/transition-policy.ts`: added `legalFromStatuses(caller, to): Status[]` (additive — `canTransition` left intact for Step 5 to migrate). UI → all statuses; Agent → the 4 legal edges' from-sets; scheduler/other → []. Added `Status` import + `AGENT_EDGES` table.
- `src/cards/transition-policy.test.ts`: new file, 3 tests (agent matrix, UI any→any, scheduler empty).

**Regressions:** none.
**Notes:** Chose a set-returning helper (not a boolean) so Step 5 can feed the from-set straight into the Mongo `$in` filter.

### Step 4: UI any→any still works (override guard)

**Status:** ✅ Done
**Test Result:** green (pre-Step-5 impl already allowed it; guard locks it in)

**Files Changed:**
- `src/cards/card.service.test.ts`: added a direct `todo -> done` UI move test (an edge the agent may not take), proving the UI path bypasses the from-set filter.

### Step 5: Agent legal-edge move (atomic) + lifecycle stamping

**Status:** ✅ Done
**Test Result:** red → green

**Files Changed:**
- `src/cards/card.service.ts`: reworked `updateTaskStatus` — branch by caller (UI → bare `{_id}` any→any; agent/other → `{_id, status: {$in: legalFromStatuses(caller, to)}}` on the same `findOneAndUpdate`); on a miss, a single follow-up `findOne` disambiguates NotFound vs InvalidTransition. Swapped the `canTransition` import for `legalFromStatuses`. Updated JSDoc.
- `src/cards/transition-policy.ts`: removed the now-dead `canTransition` (fully superseded; no remaining callers).
- `src/cards/card.service.test.ts`: added agent `in_progress -> done` test (asserts move + finishedAt + pickedAt preserved); added `Caller` import.

**Regressions:** none (13/13). tsc clean.
**Notes:** Happy path stays one atomic write; the extra `findOne` runs only on the rare miss path.

### Step 6: Agent illegal-edge move → ERR_INVALID_TRANSITION

**Status:** ✅ Done
**Test Result:** green (validates Step 5's disambiguation: existing doc + illegal source)

**Files Changed:**
- `src/cards/card.service.test.ts`: agent `todo -> done` rejected as InvalidTransition; asserts the card is left unchanged.

### Step 7: Agent move on missing card → ERR_NOT_FOUND (not InvalidTransition)

**Status:** ✅ Done
**Test Result:** green (validates the miss-path disambiguation when no doc exists)

**Files Changed:**
- `src/cards/card.service.test.ts`: agent move on an unused id reports NotFound.

**Regressions:** none across the file (13/13).

### Step 8: appErrorToToolResult mapper

**Status:** ✅ Done
**Test Result:** red → green

**Files Changed:**
- `src/mcp/tools.ts` (new): `appErrorToToolResult(error)` → `{isError:true, structuredContent:{code,message}, content:[text]}`; `CallToolResult` imported as `import type` from `@modelcontextprotocol/sdk/types.js`.
- `src/mcp/tools.test.ts` (new): unit test asserting the ERR_* code in both text and structuredContent.

### Step 9: get_my_task handler (factory)

**Status:** ✅ Done
**Test Result:** red → green

**Files Changed:**
- `src/mcp/tools.ts`: `createGetMyTask(cardId)` factory → handler calling `getTask(cardId)`, returning success structured content; one try/catch boundary mapping `AppError` → error result, re-throwing others.
- `src/mcp/tools.test.ts`: in-process integration test (useTestMongo, no transport).

### Step 10: set_my_status handler — legal move

**Status:** ✅ Done
**Test Result:** red → green

**Files Changed:**
- `src/mcp/tools.ts`: `createSetMyStatus(cardId)` factory → handler calling `updateTaskStatus(cardId, status, {caller: Agent})`. Added `toCardResult(card)` shared success builder (spread into a record to satisfy `structuredContent`'s index-signature shape — fixed a tsc error where `Card` interface isn't assignable to `Record<string, unknown>`).
- `src/mcp/tools.test.ts`: in-process test for the legal in_progress→need_review edge.

### Step 11: set_my_status handler — illegal move → error result

**Status:** ✅ Done
**Test Result:** green (validates the handler's error boundary)

**Files Changed:**
- `src/mcp/tools.test.ts`: agent todo→done returns `isError:true` with `structuredContent.code === ERR_INVALID_TRANSITION`.

**Regressions:** none. tsc clean (the "two CallToolResult types" cascade was the index-signature mismatch; resolved by `toCardResult`).

### Step 12: createMcpServer factory registers the two tools

**Status:** ✅ Done
**Test Result:** red → green

**Files Changed:**
- `src/mcp/server.ts` (new): `createMcpServer({ cardId })` → `McpServer` with `get_my_task` (no input) and `set_my_status` (`inputSchema: { status: statusSchema }`) registered, bound via the tools.ts factories. No `outputSchema` declared (kept minimal; structuredContent flows regardless).
- `src/mcp/server.test.ts` (new): asserts exactly `["get_my_task","set_my_status"]` via an in-process `InMemoryTransport` + `Client.listTools()` round-trip (SDK has no public tool registry — `_registeredTools` is private). No transport/stdio/build.

### Step 13: stdio entry reads + validates CARD_ID

**Status:** ✅ Done
**Test Result:** red → green

**Files Changed:**
- `src/mcp/index.ts` (new): `readCardId()` (pure `cardIdSchema.parse(process.env.CARD_ID)`, fails fast) + `main()` (build + connect StdioServerTransport — untested-by-design shim). Auto-run guarded by `process.argv[1] === fileURLToPath(import.meta.url)` so importing the module is side-effect-free.
- `src/mcp/index.test.ts` (new): 3 cases — valid env returns id; missing throws; malformed throws. Confirmed importing index.ts under vitest does NOT open stdio (guard works).

**Regressions:** none. Full suite 35/35 (was 18 pre-slice). tsc clean.

---

## Slice 2 status — COMPLETE ✅ (MCP server)

- **Steps 1–13:** all ✅ Done. **Quality gates (4):** all PASS. **Validation (independent, all 13 steps):** all VALID, zero defects.
- **Tests:** 35 passing across 13 files (was 18 pre-slice → +17). `tsc --noEmit` clean.
- **New module:** `src/mcp/` — `tools.ts` (handlers + factories + appErrorToToolResult), `server.ts` (createMcpServer factory), `index.ts` (stdio entry: readCardId + guarded main). Service layer gained `getTask` + agent-enforced `updateTaskStatus`; `transition-policy` gained `legalFromStatuses` (and dropped the dead `canTransition`).
- **Two agent tools, stdio, CARD_ID-scoped, no `id` arg:** `get_my_task`, `set_my_status`. Errors returned as `isError:true` with the ERR_* code; agent structurally confined to its own card.

**Discovered fix:** `createTask` insert now uses `{ ignoreUndefined: true }` (an omitted `description` was being persisted as BSON null, diverging from the create-return and the `Card.description?` type).

**Action item for the user (meta-rule: AI must not edit package.json / npm install):** `@modelcontextprotocol/sdk@1.29.0` resolves from node_modules but isn't declared in package.json — run `npm install @modelcontextprotocol/sdk@^1.29.0` for reproducibility.

**Deferred (out of scope, per plan):** `add_repo_to_workspace` tool, HTTP/SSE transport, runner launch/Claude-Code MCP config, `ERR_FORBIDDEN` (unreachable with no-`id` tools).

---

# Slice 3: Hygiene + Parse-on-Read + Audit Log

Plan: `implementation-plan-v3.md` (approved). 10 steps + 3 quality checkpoints.

### Step 1: Biome lint/format gate

**Status:** ✅ Done
**Test Type:** config-only (no test) — AC verified manually

**Files Changed:**
- `package.json`: `@biomejs/biome@2.4.16` devDep (via `npm install -D`); added `lint` (`biome check .`) + `format` (`biome format --write .`) scripts
- `biome.json` (new): 2-space/double-quote formatter, v2 `assist.actions.source.organizeImports`, `correctness/noUnusedImports=error`, `vcs.useIgnoreFile`, CSS excluded (`!**/*.css` — Tailwind v4 owns CSS), a11y `noLabelWithoutControl` off for vendored `src/components/ui/**`
- 20 source files auto-fixed by the first `biome check --write` (import sort + minor format)
- `.gitignore`: widened scratch-plan ignore to `implementation-plan-*.md`

**Regressions:** none — `npx tsc --noEmit` clean; full suite 35/35 green after auto-fix.
**Notes:** AC met — `npm run lint` clean on 61 files; a throwaway file with unused imports produced 3 errors (gate bites), then removed. IDE shows an info-only schema/CLI version mismatch (editor extension 2.3.0 vs installed 2.4.16) — harmless.

### Step 2: GitHub Actions CI + .nvmrc (Node 26)

**Status:** ✅ Done
**Test Type:** config-only (no test) — runs on GitHub, validated locally as far as possible

**Files Changed:**
- `.nvmrc` (new): `26`
- `.github/workflows/ci.yml` (new): on push/PR to `main` → checkout → setup-node (`node-version-file: .nvmrc`, npm cache) → `npm ci` → cache `~/.cache/mongodb-binaries` → `npm run lint` → `npx tsc --noEmit` → `npm run test:run`

**Regressions:** none.
**Notes:** Default branch confirmed `main`; uses `test:run` (not bare `test`, which is watch mode); `tsc` via `npx` (no typecheck script). YAML tab-free + structurally valid; lint still clean with the new files; referenced scripts exist. The actual red/green-on-PR AC can only be observed once pushed to GitHub.

### Quality Checkpoint (after steps 1-2): ✅ PASS

Config-only steps — verified inline (no sub-agent): `npm run lint` clean on 61 files; CI Node pin matches `.nvmrc` (26); Biome does not rewrite local export statements (no `export {A,B}`-convention regression). Substantive quality-gate sub-agents reserved for the code steps (3–6, 7–10).

### Step 3: findOneZ — parsed / null / log+throw on drift

**Status:** ✅ Done
**Test Result:** red → green (3 cases, one at a time)
**Test Type:** TDD (unit, useTestMongo)

**Files Changed:**
- `src/cards/errors.ts`: + `ErrorCode.SchemaDrift = "ERR_SCHEMA_DRIFT"`
- `src/cards/card.document.schema.ts` (new): `cardDocumentSchema` mirroring `CardDocument` — own ObjectId-based origin union (NOT reusing client `originSchema`), `description` `.optional()`, the 6 always-null fields `.nullable()`, `z.instanceof(ObjectId)` / `z.date()` (no coercion)
- `src/db/find-z.ts` (new): shared `parseOrThrow(schema, doc)` (safeParse → on failure `console.error` the Zod issues + throw `AppError(SchemaDrift)`) and `findOneZ` (null doc → null, else parseOrThrow)
- `src/db/find-z.test.ts` (new): 3 cases — valid→parsed (BSON types intact), absent→null, malformed (title number)→logs + throws SchemaDrift (asserted via `vi.spyOn(console,"error")` + `rejects.toMatchObject`)

**Regressions:** none — full suite 38/38 (was 35), `tsc --noEmit` clean, `biome check .` clean on 64 files.
**Notes:** `schema: ZodType<T>` generic type-checks against `Collection<CardDocument>`. `console.error` chosen as the log mechanism (no logger exists; adding one is out of scope). Helper `parseOrThrow` is the reuse seam for Steps 4–5.

### Step 4: findManyZ — array / empty / sort / log+throw on any drift

**Status:** ✅ Done
**Test Result:** case 1 red → green; cases 2 & 4 covered by impl + shared parseOrThrow; case 3 (sort) surfaced + fixed a test-isolation bug → green
**Test Type:** TDD (unit, useTestMongo)

**Files Changed:**
- `src/db/find-z.ts`: + `findManyZ(collection, filter, schema, options?)` → `find(filter, options).toArray()` then `.map(parseOrThrow)`; imported `FindOptions`
- `src/db/find-z.test.ts`: 4 findManyZ cases (parsed array, empty, sort-forwarding, any-drift throws) + a `beforeEach` collection cleanup

**Regressions:** none — find-z 7/7, `tsc --noEmit` clean.
**Notes:** The sort test caught a real Reliability bug — `useTestMongo` doesn't reset between `it`s, so case 1's inserts leaked into the read-all sort test (`[3,2,1,0,0]`). Fixed with a `beforeEach` `deleteMany({})` in the findManyZ describe (each test owns its state). `findManyZ` forwards `FindOptions` so Step 6 (`listTasks` order) and Step 10 (`at` sort) are unblocked. One drifted doc fails the whole read (no partial results), via the same `parseOrThrow`.

### Step 5: findOneAndUpdateZ — after-image / null on miss / log+throw on drift

**Status:** ✅ Done
**Test Result:** case 1 red → green; cases 2 (miss) & 3 (drift) covered by impl + shared parseOrThrow
**Test Type:** TDD (unit, useTestMongo)

**Files Changed:**
- `src/db/find-z.ts`: + `findOneAndUpdateZ(collection, filter, update: UpdateFilter<T> | Document[], schema, options?)` → forwards options (incl. `returnDocument:"after"`), null-guards the miss, then `parseOrThrow`; imported `FindOneAndUpdateOptions`, `UpdateFilter`
- `src/db/find-z.test.ts`: 3 cases (after-image returned, null on miss, drifted after-image throws) + `beforeEach` cleanup

**Regressions:** none — full suite 45/45 (was 38), `tsc --noEmit` clean, `biome check .` clean.
**Notes:** `update` typed `UpdateFilter<T> | Document[]` so Step 6's aggregation-pipeline `updateTaskStatus` update is accepted. Driver 7.2.0 returns the doc directly (no `{value}` wrapper). Case 1 asserts the AFTER title, proving options (`returnDocument:"after"`) are forwarded — without forwarding it returns the before-image and reds.

### Step 6: Migrate getTask / listTasks / updateTaskStatus read-back onto *Z wrappers

**Status:** ✅ Done
**Test Result:** no new tests (migration) — existing card.service suite is the regression gate, 13/13 green
**Test Type:** migration

**Files Changed:**
- `src/cards/card.service.ts`: `getTask` → `findOneZ`; `listTasks` → `findManyZ(..., { sort: { priority:-1, createdAt:1 } })`; `updateTaskStatus` read-back → `findOneAndUpdateZ(..., cardDocumentSchema, { returnDocument:"after" })`. Miss-path `findOne({_id})` left RAW (avoids masking InvalidTransition as SchemaDrift). Imported `findOneZ`/`findManyZ`/`findOneAndUpdateZ` + `cardDocumentSchema`.

**Regressions:** none — full suite 45/45, `tsc --noEmit` clean, `biome check .` clean.
**Notes:** Confirmed `cardDocumentSchema` accepts every shape `createTask` produces (description omitted → `.optional()` holds; all 6 always-null fields present as `null`). `card.service.ts` is 214 lines (< 300). Reads now parse-on-read; drift surfaces as a logged SchemaDrift AppError instead of silently flowing into the mapper.

### Quality Checkpoint (after steps 3-6): ✅ PASS

Sub-agent review of the parse-on-read wrapper + migration. Verdict **pass**, zero issues/fixes. Confirmed: parse failure logs (`console.error`) + throws `AppError(SchemaDrift)`, never returns raw; null/miss returns null without parsing; `findManyZ` fails whole read on any drift; `cardDocumentSchema` uses its own ObjectId origin union; description `.optional()`, 6 fields `.nullable()`, no coercion; miss-path findOne correctly left raw. 4 Pillars: all strong. `npm run lint` + `npx tsc --noEmit` + 45 tests all green; all files < 300 lines.

### Step 7: Creating a card writes one success event (from=null, to=todo)

**Status:** ✅ Done
**Test Result:** red (0 events) → green
**Test Type:** TDD (integration, useTestMongo)

**Files Changed:**
- `src/cards/card-event.type.ts` (new): `EventOutcome` enum (success/failure), `CardEventError`, `CardEventDocument` ({_id, cardId, from: Status|null, to, caller, at, outcome, error})
- `src/cards/card-event.service.ts` (new): `emitCardEvent(db, event)` — stamps `_id` + `at`, inserts into card_events
- `src/db/collections.ts`: + `cardEventsCollection(db)` accessor
- `src/db/indexes.ts`: + `{ cardId: 1, at: 1 }` index on card_events in bootstrapIndexes
- `src/cards/card.service.ts`: `createTask` emits a create event after a successful insert (from=null, to=Todo, caller=Ui, outcome=Success, error=null) using `doc._id`
- `src/cards/card.service.test.ts`: + "card events — create" describe (1 test)

**Regressions:** none — full suite 46/46, `tsc --noEmit` clean, `biome check .` clean.
**Notes:** `createTask` takes NO new caller param — all creation is UI today, so the create event hardcodes `Caller.Ui` (avoids an unused-future param per scope rule). `cardEventDocumentSchema` deferred to Step 10 (where findManyZ consumes it); Step 7's test reads back via the raw typed accessor.

### Step 8: A successful transition writes one success event carrying caller and from→to

**Status:** ✅ Done
**Test Result:** red (no transition event) → green
**Test Type:** TDD (integration, useTestMongo)

**Files Changed:**
- `src/cards/card.service.ts`: `updateTaskStatus` now reads the pre-image ONCE up front (raw findOne) — reused for both the audit `from` and the miss-path NotFound/InvalidTransition disambiguation (replacing the old on-miss findOne). On success it emits a `success` event (from=preImage.status, to=status, resolved caller, error=null) before returning.
- `src/cards/card.service.test.ts`: + "card events — transition" describe (1 success-transition test)

**Regressions:** none — full suite 47/47, all 6 prior updateTaskStatus tests (incl. NotFound + InvalidTransition) still green, `tsc --noEmit` clean, `biome check .` clean.
**Notes:** `card.service.ts` now 239 lines (< 300). Non-atomic window (pre-read → conditional update) acknowledged — acceptable for an audit trail. `at` uses `new Date()` in app code (the Date.now meta-rule applies to workflow scripts, not app code). The single up-front read avoids the redundant query the old miss-path used.

### Step 9: A rejected transition writes one failure event with the error code/message

**Status:** ✅ Done
**Test Result:** red (no failure event) → green (2 cases: illegal transition + missing card)
**Test Type:** TDD (integration, useTestMongo)

**Files Changed:**
- `src/cards/card.service.ts`: the `updateTaskStatus` miss path now builds the AppError (InvalidTransition if pre-image exists, else NotFound), emits ONE `failure` event (from=preImage?.status ?? null, to=status, caller, error={code,message}), then throws. Single emit + ternary keeps it DRY (no premature helper for 2 occurrences).
- `src/cards/card.service.test.ts`: + "card events — failure" describe (2 tests: illegal todo→done by agent → failure event with ERR_INVALID_TRANSITION + from=todo; missing card → failure event with ERR_NOT_FOUND + from=null)

**Regressions:** none — full suite 49/49, all prior throw-path tests still green, `tsc --noEmit` clean, `biome check .` clean.
**Notes:** `card.service.ts` 250 lines (< 300). The `outcome` discriminator resolves the from=null ambiguity (a NotFound failure with from=null vs a create success with from=null are now distinguishable). Emit is a plain `await` before the throw (no defensive try/finally). NotFound now DOES emit (per the user's "log detailed errors for dev investigation" decision) — stored under the requested-but-phantom cardId.

### Step 10: Events for a card are read back in chronological order

**Status:** ✅ Done
**Test Result:** red (not implemented) → green
**Test Type:** TDD (integration, useTestMongo)

**Files Changed:**
- `src/cards/card.document.schema.ts`: + `cardEventDocumentSchema` (mirrors CardEventDocument — ObjectId/Date no coercion, from `.nullable()`, error object `.nullable()`)
- `src/cards/card-event.service.ts`: + `listCardEvents(cardId)` → `findManyZ(cardEventsCollection, { cardId: new ObjectId(cardId) }, cardEventDocumentSchema, { sort: { at: 1, _id: 1 } })`
- `src/cards/card.service.test.ts`: + "card events — chronological read-back" describe (1 test: create + 3 transitions → 4 events oldest-first)

**Regressions:** none — full suite 50/50, `tsc --noEmit` clean, `biome check .` clean.
**Notes:** Sort key `{ at: 1, _id: 1 }` — ObjectId is monotonic within a process, so same-millisecond events keep a deterministic insertion order (avoids the flaky sub-ms tie the investigation flagged). Read converts the hex `cardId` to ObjectId (events store ObjectId). The read-back validates each event through `cardEventDocumentSchema` (parse-on-read). Sizes: card-event.service 59, card.document.schema 70, card.service 250, find-z 95 — all < 300.

### Quality Checkpoint (after steps 7-10): ✅ PASS

Sub-agent review of the audit/event log. Verdict **pass**. Verified: event carries exactly {cardId, from, to, caller, at, outcome, error} (no reason/message); create emits success/from=null/to=todo/caller=ui AFTER the insert try-catch (dup-key → no create event); success transition from=preImage.status; rejected transition emits failure with AppError code+message (both InvalidTransition and NotFound; NotFound from=null); pre-image read exactly once and reused; emit is plain await before throw (no try/finally); `at` via new Date(); read sorts {at:1,_id:1}. 4 Pillars all satisfied.
**Fix applied:** card.service.test.ts had grown to 380 lines (over the 300 rule) — split the 4 event describes into a new `src/cards/card-event.service.test.ts` (157 lines); card.service.test.ts now 231. No behavior changed. lint (67 files) + tsc + 50 tests all green.

---

## Validation (Phase 5) — independent, all steps VALID ✅

Two parallel validators independently re-derived each step's AC against the code + real test runs.
- **Parse-on-read (steps 3–6): all VALID.** No read path missed (only intentional raw reads: the updateTaskStatus pre-image + counters.ts, both out of scope); no silent-pass drift path; schema matches CardDocument field-for-field; ZodType<T> sound, no casts.
- **Audit log (steps 7–10): all VALID.** Correct payloads; create emits only after a successful insert; single reused pre-image; failure emits before throw; read sorts {at:1,_id:1}; event schema carries ONLY the agreed fields (no reason/message); all files < 300.
- **One caveat closed:** validators flagged that "a duplicate create leaves no event" was correct-by-construction but untested. Added that hardening test (`card-event.service.test.ts`) + a `beforeEach` cleanup to keep the count-based assertion isolated.

## Slice 3 status — COMPLETE ✅ (Hygiene + Parse-on-Read + Audit Log)

- **Steps 1–10:** all ✅ Done. **Quality gates (2):** PASS. **Validation:** all VALID.
- **Tests:** 51 passing across 15 files (was 35 → +16). `tsc --noEmit` clean. `biome check .` clean on 67 files. All files < 300 lines.
- **Item 1 (hygiene):** Biome 2.4.16 (`biome.json`, lint/format scripts) + GitHub Actions CI (`.github/workflows/ci.yml`, `.nvmrc`=26).
- **Item 3 (parse-on-read):** `src/db/find-z.ts` (`findOneZ`/`findManyZ`/`findOneAndUpdateZ` + `parseOrThrow`), `cardDocumentSchema`, `ErrorCode.SchemaDrift`; getTask/listTasks/updateTaskStatus read-back migrated.
- **Item 2 (audit log):** `card_events` collection + accessor + `{cardId,at}` index; `CardEventDocument`/`EventOutcome`; `card-event.service.ts` (`emitCardEvent`/`listCardEvents`); create + success-transition + failure events with `outcome` + `error` discriminator; chronological read-back.
