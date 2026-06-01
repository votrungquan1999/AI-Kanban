# Patterns & Conventions

Conventions that are non-obvious or specific to this repo. Generic best practices are omitted. The `.claude/rules/` directory holds the enforced rule set; this file highlights what actually shows up in the code.

## Data layer

- **Two types per entity, always.** `XDocument` (DB shape, ObjectId/Date) vs `X` (client shape, hex/ISO strings), converted by a `*.mapper.ts`. Raw documents are never returned from the service. See `card.type.ts` + `card.mapper.ts`.
- **Parse-on-read everywhere.** Never call `collection.findOne` directly in service code — use `findOneZ`/`findManyZ`/`findOneAndUpdateZ` from `src/db/find-z.ts`, which validate against a Zod *document* schema and throw `ERR_SCHEMA_DRIFT` on mismatch. The one deliberate raw read is the `updateTaskStatus` pre-image (so drift can't mask NotFound/InvalidTransition).
- **Atomicity over transactions.** Every state change is a single-document `findOneAndUpdate`. Concurrency safety comes from the *filter* (e.g. claim filters on `status: todo`; transition filters on legal source statuses via `$in`). When an update matches nothing, read the pre-image to disambiguate the failure reason.
- **`ignoreUndefined: true` on insert** so optional fields (e.g. `description?`) stay *absent* rather than persisting as BSON `null` — keeping create/read consistent with the optional-property type.

## Schema / validation

- **One Zod schema, shared client + server.** `createTaskInputSchema` backs both the web form Server Action and the service. Validation is the *single* intentional parse boundary (the repo forbids defensive try/catch elsewhere).
- **`z.input` vs `z.output`** are exported as separate types (`CreateTaskInput` vs `ParsedCreateTaskInput`) so callers may omit defaulted fields while internal code sees them applied.

## Enums, not string unions

Per `typescript-conventions`, fixed value sets are TS `enum`s (`Status`, `OriginType`, `RunState`, `Caller`, `ErrorCode`, `EventOutcome`) — not string-literal unions. Zod uses `z.enum(Status)`.

## MCP tool handlers

- Handlers are **built by factory functions** (`createClaimCard()`, `createSetMyStatus(cardId)`, …) returning the async handler — so the card-scoped ones close over `cardId` and the generic ones take `id` as an argument.
- Handlers catch only `AppError` → `appErrorToToolResult` (readable error to the agent); anything else re-throws. This is the intentional error boundary.
- Tool entry modules auto-run only when executed directly, so test imports are side-effect-free.

## Web UI (RSC + Server Actions)

The repo follows a strict React Server Component file-structure convention (see `.claude/rules/file-structure-patterns.md`):
- `component.tsx` = server component (data + composition); `*.ui.tsx` = `'use client'` display (styling/layout, `children`-driven, **no** data fetching); `*.state.tsx` = client state/hooks; `*.type.ts` = shared types. **`*.client.tsx` is prohibited.**
- Data is **read in the RSC that uses it**; writes go through **Server Actions** (`app/(board)/actions.ts`) that call the same service functions and `revalidatePath('/')`.
- **URL drives dialog/drawer state** server-side (`?new=task`), via an `href.ts` factory (`newTaskHref()`) — not client `useSearchParams`.
- Drag-to-move = `@dnd-kit` + `useOptimistic` (`board.tsx` + `board.move.ts`): optimistic relocate, auto-revert if the action fails.
- Hooks rules: no defensive `useCallback`/`useMemo`; `useEffect` only for external-resource sync; prefer `createReducerContext`-derived domain hooks. Styling uses tokenized Tailwind colors, `size-*` not `w-/h-`, `pile` not `absolute`, grid-first layout.

## Imports / exports

- **Individual export statements only** — no `export { A, B, C }` or `export type { … }` barrels (traceability rule).
- Path alias `@/*` → `src/*` (configured in `tsconfig.json` and mirrored in `vitest.config.ts`).
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.

## Documentation discipline

- Every function carries a JSDoc block (enforced). The code's JSDoc is unusually detailed and explains *why* (e.g. the `updateTaskStatus` block documents the pre-image disambiguation).
- Design lives in `docs/design/` (authoritative) and supersedes `docs/brainstorm/` (history) where they conflict. Architecture decisions are dated ADRs in `docs/adr/`.
