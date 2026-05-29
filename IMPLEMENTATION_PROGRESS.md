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

**Quality checkpoint (data layer, Steps 1–4):** full suite 7/7 green across 5 files. Quality-gate review pending.
