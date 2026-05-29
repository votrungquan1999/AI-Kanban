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

**Quality checkpoint (service layer, Steps 5–7):** full suite 14/14 green across 6 files. Quality-gate review pending.
