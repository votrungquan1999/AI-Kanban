# Implementation Progress: Candidate 2′ Pool Dispatch (BDD)

Design: [docs/design/pool-dispatch.md](docs/design/pool-dispatch.md). (The BDD plan and scenario scratch files were transient orchestrated-workflow state and have been removed; this doc is the durable record of the slice.)

### Step 1: A created card starts with empty workspace bookkeeping and survives a read

**Status:** ✅ Done
**Test Result:** test 1 red → green; test 2 already covered (required-field schema rejects legacy docs)

**Tests (2 scenarios, all passing ✅):**

1. ✅ A newly created card starts with empty workspace bookkeeping (create + read round-trip)
2. ✅ A stored card missing the new bookkeeping is rejected on read (ERR_SCHEMA_DRIFT)

**Files Changed:**
- card.type.ts: added `RepoEntry` interface; `workspacePath`/`repos` on `CardDocument` and `Card`
- card.document.schema.ts: added `repoEntrySchema`; `workspacePath` (nullable) + `repos` (array, required) on `cardDocumentSchema`
- card.mapper.ts: map `workspacePath`/`repos` through to the client card
- card.service.ts: `createTask` initializes `workspacePath: null`, `repos: []`
- card.service.test.ts: +2 scenarios; imported `RunState`, `cardsCollection`
- find-z.test.ts: `makeCardDocument` fixture gains the two new fields (lockstep fixture fix)

**Regressions:** 4 find-z.test.ts failures from the tightened schema → fixed by updating the fixture builder. Full suite 53/53 green, biome clean.
**Notes:** Lockstep type+schema+mapper kept exact. `Card` reuses `RepoEntry` directly (pure strings, no conversion).

### Step 2: A todo card is atomically claimed

**Status:** ✅ Done
**Test Result:** red → green

**Tests (1 scenario, passing ✅):**

1. ✅ Atomically claims a todo card and records the claim without an owner

**Files Changed:**
- card.claim.service.ts: NEW — `claimCard(id): Promise<Card | null>`, single operator-style `findOneAndUpdate({_id, status: todo}, {$set status/runState/pickedAt, $inc attempts})`, `Caller.Agent` success audit row on a hit, `null` on a miss (no failure row, no owner field)
- card.claim.service.test.ts: NEW — integration test with `beforeEach deleteMany` on cards + card_events (Step 3 reuses)

**Regressions:** none (claim is a dedicated file; updateTaskStatus/transition-policy untouched). Biome clean.
**Notes:** `runState`/`attempts` asserted via a raw `cardsCollection.findOne` (not on the client `Card`); audit asserted as create+claim = 2 events.

### Step 3: A second/concurrent claim loses (no double-assignment)

**Status:** ✅ Done
**Test Result:** all 3 already covered (loser/unknown-id/race fall out of Step 2's `{_id, status: todo}` filter + null-on-miss) — no production code added

**Tests (3 scenarios, all passing ✅):**

1. ✅ Loses a second claim of an already-claimed card and leaves it unchanged
2. ✅ Yields nothing when claiming a card that does not exist
3. ✅ Lets exactly one claim win when 25 race for one card (winners === 1, persisted attempts === 1; stable x3, non-flaky)

**Files Changed:**
- card.claim.service.test.ts: +3 scenarios (test-only). Race uses `Promise.all` of 25, asserts a literal winner count of 1 AND `attempts === 1`.

**Regressions:** none. **Notes:** confirms document-level atomicity on standalone in-memory mongod is the mutual-exclusion guarantee (no transaction).

## Quality Checkpoint (after steps 1-3): ✅ PASS

Quality-gate sub-agent verdict: pass. 4 Pillars verified (race test genuinely sensitive + non-flaky), lockstep type/schema/mapper consistent, all files <300 lines, no rule violations, no fixes needed.

### Step 4: Declaring workspace state replaces it idempotently

**Status:** ✅ Done
**Test Result:** test 1 (replace) red → green; tests 2 (idempotent) & 3 (malformed→ERR_VALIDATION) already covered by the replace + pre-write validation built in test 1's green

**Tests (3 scenarios, all passing ✅):**

1. ✅ Replaces the card's workspace state with the declared path and repos
2. ✅ Idempotent when the same state is declared twice (no duplicate growth)
3. ✅ Rejects a malformed declaration with ERR_VALIDATION, stored card untouched

**Files Changed:**
- card.workspace.service.ts: NEW — `setWorkspace(id, declaration)`: pre-write `safeParse` → `throw AppError(ERR_VALIDATION)` (first real use of the code; raw ZodError would crash the Step-6 MCP boundary), `$set` replace of `workspacePath`/`repos`/`updatedAt` (idempotent PUT), `ERR_NOT_FOUND` on missing id, no audit row. Separate input schema (`workspaceDeclarationSchema`, non-empty strings) per type-separation — distinct from the read-path doc schema.
- card.workspace.service.test.ts: NEW — 3 integration scenarios, `beforeEach deleteMany`.

**Regressions:** none. Full suite 60/60 green, biome clean.
**Notes:** validation-before-write means the malformed path issues no DB update, so "stored bookkeeping unchanged" holds for free.

### Step 5: The dispatch claim tool claims a card by id

**Status:** ✅ Done
**Test Result:** test 1 (success) red → green; test 2 (readable failure) already covered by the null-handling built in test 1's green

**Tests (2 scenarios, all passing ✅):**

1. ✅ Claims a todo card by id and returns it as success, now in progress
2. ✅ Reports a failed claim (already-claimed AND unknown id) as a readable error result without throwing

**Files Changed:**
- mcp/tools.ts: exported `toCardResult` (reused by dispatch tools — avoids success-shape drift; investigation's recommended choice over re-implementing)
- mcp/dispatch-tools.ts: NEW — `createClaimCard()` returns an id-argument handler. Success → `toCardResult`; `null` claim → hand-built `claimUnavailableResult` (`isError: true`, one generic message since already-claimed/missing are indistinguishable); `AppError` throw → `appErrorToToolResult`; other throws re-thrown.
- mcp/dispatch-tools.test.ts: NEW — handler tested directly (matches tools.test.ts convention; full server round-trip deferred to Step 7).

**Regressions:** none. Biome clean. **Notes:** no `WORKER_ID`/lease/`ERR_FORBIDDEN`; no new error codes.

### Step 6: The dispatch context, status, and workspace tools act on a card by id

**Status:** ✅ Done
**Test Result:** context + legal-move + workspace each red → green; illegal-move already covered by the AppError catch in createSetStatus's green

**Tests (4 scenarios, all passing ✅):**

1. ✅ get_card_context returns a card's task context by id
2. ✅ set_status moves a card to a legal next status by id and records it in the audit log
3. ✅ set_status refuses an illegal change as a readable ERR_INVALID_TRANSITION result, card unchanged
4. ✅ set_workspace declares workspace state by id and reflects it on the card

**Files Changed:**
- mcp/dispatch-tools.ts: added `createGetCardContext` (wraps getTask), `createSetStatus` (wraps updateTaskStatus as `Caller.Agent`; in_progress→need_review is a legal agent edge; AppError→readable result), `createSetWorkspace` (wraps setWorkspace). All mirror the existing tools.ts try/catch boundary. File at 116 lines.
- mcp/dispatch-tools.test.ts: +4 scenarios.

**Regressions:** none. Biome clean. **Notes:** thin wrappers — `updateTaskStatus`/`setWorkspace` already enforce policy/validation and emit audit rows; tools only map thrown AppErrors. No defensive try/catch beyond the one intentional boundary per handler.

### Step 7: The dispatch server registers exactly its tools and starts over stdio

**Status:** ✅ Done
**Test Result:** server listTools red → green; entrypoint red (module missing) → green

**Tests (2 scenarios, all passing ✅):**

1. ✅ Dispatch server exposes exactly claim_card, get_card_context, set_status, set_workspace (listTools round-trip over InMemoryTransport)
2. ✅ Entrypoint exposes an env-free generic server, side-effect-free on import, per-card server intact

**Files Changed:**
- mcp/dispatch-server.ts: NEW — `createDispatchMcpServer()` registers exactly the 4 id-argument tools. `set_workspace` inputSchema reuses `workspaceDeclarationSchema.shape` (exported from the workspace service) to avoid drift.
- mcp/dispatch-index.ts: NEW — env-free `main()` (no `readCardId`, no identity) + side-effect-free `fileURLToPath(import.meta.url)` main-guard.
- card.workspace.service.ts: exported `workspaceDeclarationSchema` (for the tool inputSchema).
- mcp/dispatch-server.test.ts, mcp/dispatch-index.test.ts: NEW.

**Regressions:** none. Full suite 68/68 green, biome clean (ran `npm run format` once for the new server file). Existing CARD_ID-scoped server/tools/entry untouched (additive).

## Quality Checkpoint (after steps 4-7): ✅ PASS

Quality-gate sub-agent verdict: pass. All four sensitivity concerns verified (idempotency catches append-vs-replace; ERR_VALIDATION proven pre-write so the card is untouched; dispatch failure proves no throw; exact 4-tool registration). safeParse→AppError confirmed (no raw ZodError to the MCP boundary), no new error codes, single intentional try/catch per handler, all files <300 lines, input/read-path schema separation respected. Follow-up applied: refreshed the 3 Step-6 handler JSDocs that still read "skeleton — not yet implemented".

### Step 8: The ai-kanban-work-card multi-file skill drives the dispatch flow (cross-repo)

**Status:** ✅ Done (code-complete; AI-rules-repo push + user sync pending)
**Test Result:** structural test red (files missing) → green

**Tests (1 scenario, passing ✅):**

1. ✅ Defines a multi-file skill that drives the dispatch flow (structural — file presence + frontmatter + content tokens)

**Files Changed:**
- AI-rules-repo `skills/claude-code/ai-kanban-work-card/SKILL.md`: NEW — frontmatter (name, description, `allowed-tools` = the 4 `mcp__ai-kanban-dispatch__*` tools + Bash); prose `<id>` + `/ai-kanban-work-card <id>` usage (no frontmatter argument key); flow referencing the 3 step files.
- AI-rules-repo `.../steps/1-claim.md`, `2-prepare-worktrees.md`, `3-work-and-complete.md`: NEW — plain markdown (no frontmatter), mirroring the orchestrated-feature-dev nodes pattern. Step 2 documents `aikanban/card-N` / `workspaces/card-N/<repo>` conventions, branch-exists/path-occupied/dirty recovery, and the FULL-set `set_workspace` gotcha.
- AI-rules-repo `tests/skills/ai-kanban-work-card.test.ts`: NEW — dependency-free structural assertions on stable tokens (resilient, not exact-prose). AI-rules-repo vitest has no include restriction, so it runs.
- AI-Kanban `.ai-rules.json`: added `"ai-kanban-work-card"` to `skills[]`.

**Regressions:** none. AI-rules-repo: structural test green; biome clean on my new files (3 pre-existing lint errors in untouched files — vitest.config.ts etc. — left alone per scope discipline). Server name pinned to `ai-kanban-dispatch` (matches dispatch-server.ts).
**Cross-repo flow:** pulled latest main first ✅ → authored + test green ✅ → commit + push to main (pending user confirm) → **user runs the sync** into AI-Kanban/.claude/skills/.

---

# Implementation Progress: Board UX "Dispatch Launchpad" (v3)

Plan: `implementation-plan-v3.md` · Steps: `PLAN_STEPS-v3.md`

### Step 0: UI building blocks (groundwork)

**Status:** ✅ Done
**Test Result:** n/a (install/wiring; verified by tsc + biome and by consuming steps)

**Files Changed:**
- `src/components/ui/dropdown-menu.tsx`, `select.tsx`, `textarea.tsx`, `alert-dialog.tsx`: added via `npx shadcn@latest add` (base-nova registry); existing `button.tsx` left untouched (declined overwrite)
- `src/components/ui/drawer.tsx`: new, hand-authored bottom-sheet over `@base-ui/react/dialog` (no vaul)
- `src/components/ui/toast.tsx`: new, styled Base-UI toast parts + `useToast()` manager hook
- `src/components/ui/toaster.tsx`: new, renders the live toast queue into a portal
- `app/layout.tsx`: wrapped body in `<ToastProvider>` and mounted `<Toaster />`

**Regressions:** none (tsc exit 0, biome exit 0)
**Notes:** Corrected the planned install — base-nova has no `menu`/`toast` slugs, so used `dropdown-menu` and hand-authored toast/toaster/drawer. UI primitive files use the codebase's combined `export { … }` convention (matches button/dialog + Biome assist).

### Step 1: `createReducerContext` primitive (groundwork)

**Status:** ✅ Done
**Test Result:** test 1 red → green; test 2 (missing-provider guard) passed once the full primitive landed

**Tests (2 scenarios, all passing ✅):**

1. ✅ Seeds initial state from provider props and updates it via dispatch
2. ✅ Throws a clear error when the state hook is used outside its provider

**Files Changed:**
- `src/lib/create-reducer-context.tsx`: new — generic factory returning `[Provider, useState, useDispatch]` over `useReducer`; provider props merge over `initialState`; `Symbol` sentinel so the guard fires even on falsy/null state
- `src/lib/create-reducer-context.test.tsx`: new — 2 jsdom unit tests

**Regressions:** none (tsc exit 0, biome exit 0)
**Notes:** `State extends object` so `...initialState` spread is well-typed. Domain-specific hook transformation (per state rules) happens in consumers (Step 6's `card-detail.state.tsx`), not in the primitive.

### Step 2: Tile quick-copy → `/ai-kanban-work-card <id>` + toast (Slice A)

**Status:** ✅ Done
**Test Result:** red (no button) → green

**Tests (1 scenario, passing ✅):**

1. ✅ Tapping the copy control copies exactly `/ai-kanban-work-card <id>` and shows a "Copied" toast

**Files Changed:**
- `app/(board)/copy-dispatch.state.tsx`: new — generic `useCopyDispatch()` → `copy(text, confirmation?)` (clipboard write + toast on success); value-agnostic so Steps 3 & 8 reuse it
- `app/(board)/copy-dispatch.ui.tsx`: new — `CopyDispatch` button; builds the command at the call site; `stopPropagation` on pointer-down AND click so the press never starts a drag
- `app/(board)/copy-dispatch.test.tsx`: new — jsdom test with stubbed clipboard, asserts the literal command + toast
- `app/(board)/card.ui.tsx`: mounts `<CopyDispatch cardId={card.id} />` in the tile's top row
- `app/(board)/board.test.tsx`: wrapped render in `<ToastProvider>` (lockstep — the real layout provides it; the tile now consumes `useToast`)

**Regressions:** board.test.tsx threw `useToastManager must be used within <Toast.Provider>` once the tile consumed the toast → fixed by wrapping the test render in `<ToastProvider>` (mirrors layout). Full `app/(board)` suite 5/5 green, tsc + biome clean.
**Notes:** Command built at call site (`/ai-kanban-work-card ${cardId}`), not baked into the hook. Toast confirmation title "Copied dispatch command".

### Step 3: Copy dropdown — command vs raw id (Slice A)

**Status:** ✅ Done
**Test Result:** new menu test red (no "Copy options" trigger) → green

**Tests (1 new scenario; 2/2 in file passing ✅):**

1. ✅ Opening the copy menu offers both choices; picking "id" copies just the bare 24-char id

**Files Changed:**
- `app/(board)/copy-dispatch.ui.tsx`: split control — primary button copies the command (one tap), adjacent caret opens a `DropdownMenu` with "Copy command" / "Copy id"
- `app/(board)/copy-dispatch.test.tsx`: +1 menu test; tightened the Step 2 selector to `/copy dispatch command/i` (two copy-related buttons now exist); switched cleanup off `delete` to `defineProperty`

**Regressions:** none. `app/(board)` 6/6 green, tsc + biome clean.
**Notes:** Base-UI Menu opens inside a `frame.request` (rAF) — `getByRole` ran before the frame; fixed by awaiting `findByRole` (Reliability), NOT a `stopPropagation` issue. `onPointerDown` stopPropagation on the trigger is safe (merged handlers still set floating-ui's pointerType; only DOM bubbling to the drag listener is stopped).

## Quality Checkpoint (after steps 1–3): ✅ PASS

Quality-gate sub-agent verdict: pass, no fixes required. 4 Pillars verified (literal command/id assertions; clipboard stub/restore; rAF-aware `findByRole`). All 15 changed files <300 lines, JSDoc present, no defensive try/catch, Base-UI `render={}` composition correct, export convention consistent with siblings. Checks: `vitest "app/(board)" src/lib` 8/8, `tsc --noEmit` clean, `biome check` clean. Non-blocking note: `useCopyDispatch` is generically reusable (Step 8 reuses as-is); name could become `useClipboardCopy` later but left as-is to avoid churn.

> Tooling note: run tests via `pnpm run test:run "<path>"` from the AI-Kanban dir (uses local vitest 4.1.7). Do NOT use `npx vitest` — it ignores the local install and tries to fetch from the registry (network-flaky here). Also re-`cd` into AI-Kanban per command; the shell cwd drifts back to the repo root.

### Step 4: Drag handle is the only draggable zone (Slice B)

**Status:** ✅ Done
**Test Result:** red (no grip button) → green

**Tests (1 scenario, passing ✅):**

1. ✅ The drag activator (`aria-roledescription="draggable"`) lives on the grip button, not on the card body

**Files Changed:**
- `app/(board)/draggable-card.ui.tsx`: moved dnd-kit `attributes`+`listeners` off the tile root onto a dedicated grip `<button>` via `setActivatorNodeRef`; `setNodeRef`+transform stay on the outer element (whole card still drags visually). Grip sits in a left-gutter grid column (`grid-cols-[auto_1fr]`, `touch-none`) — no `absolute`, per the layout rule.
- `app/(board)/draggable-card.test.tsx`: new — DndContext-wrapped test asserting the grip carries the activator and the body does not (no real drag simulated; PointerSensor isn't drivable in jsdom)

**Regressions:** none. `app/(board)` 7/7 green, tsc + biome clean.
**Notes:** Body still shows `cursor-grab` from `card.ui.tsx`; that becomes a tap-to-open link in Step 5. Grip uses `lucide-react` `GripVertical` (already installed).

### Step 5: Tap tile body → navigate to `?card=<id>` (Slice B)

**Status:** ✅ Done
**Test Result:** red (body not a link) → green

**Tests (1 scenario, passing ✅):**

1. ✅ The card body is a link to `/?card=<id>` (e.g. `/?card=abc`)

**Files Changed:**
- `app/(board)/href.ts`: added `cardDetailHref(cardId)` → `/?card=${cardId}` (mirrors `newTaskHref`)
- `app/(board)/draggable-card.ui.tsx`: wrapped `CardTile` in a `next/link` `<Link href={cardDetailHref(card.id)}>`; grip stays a sibling outside the link
- `app/(board)/copy-dispatch.ui.tsx`: menu trigger now also `stopPropagation`s on click so opening the menu doesn't bubble to the body link
- `app/(board)/card.ui.tsx`: removed `cursor-grab`/`active:cursor-grabbing` (body is a tap-to-open link now, drag is on the grip)
- `app/(board)/draggable-card.test.tsx`: +1 nav test

**Regressions:** none. `app/(board)` 8/8 green, tsc + biome clean.
**Notes:** Copy buttons (primary + menu trigger) sit inside the body link but `stopPropagation` on click, so they copy without navigating; menu items render in a portal (outside the link) so their clicks never bubble. `?card` is inert until Step 6 reads it.

### Steps 6 & 7: Detail sheet opens from `?card=<id>`, closes back to the board (Slice C)

**Status:** ✅ Done
**Test Result:** Step 6 red (null skeleton) → green; Step 7 close test green (handler intrinsic to the drawer = already covered)

**Tests (2 scenarios, passing ✅):**

1. ✅ Opening a card shows its full details (title, description, status, repo·branch·worktree)
2. ✅ Closing the sheet navigates back to the board (`router.replace("/")`)

**Files Changed:**
- `app/(board)/card-detail.ui.tsx`: new — `CardDetail({ card, open })` Base-UI bottom drawer; read-only field display (title/#/description/status/priority/repos/workspace/timestamps), null/empty fields rendered calmly; close → `router.replace(boardHref())` (reuses `/`, no `closeDetailHref`); deterministic UTC timestamp format
- `app/page.tsx`: reads `?card`, `resolveDetailCard()` wraps `getTask` in try/catch (intentional boundary — bad/unknown id → board with no sheet, no crash), renders `<CardDetail>`
- `app/(board)/card-detail.test.tsx`: new — 2 jsdom tests; hoisted shared `replace` router mock

**Regressions:** none. `app/(board)` suite green, tsc + biome clean.
**Notes:** Deferred `card-detail.state.tsx` (createReducerContext) to Step 15 — no client edit state to hold yet (open/close is URL-driven); building an empty provider now would be an unused-feature violation. `CardDetail` props kept additive for Steps 8/9/15/18.

### Step 8: Copy-field icons in the sheet (Slice C)

**Status:** ✅ Done
**Test Result:** red (no "Copy branch" button) → green

**Tests (1 new scenario; 3/3 in file passing ✅):**

1. ✅ Tapping a field's copy icon copies just that field's raw value (branch → "aikanban/card-7")

**Files Changed:**
- `app/(board)/card-detail.ui.tsx`: added `CopyField` (icon button reusing the Step 2 `useCopyDispatch` hook) + `CopyableRow`; wired copy affordances onto Card id, each repo's branch & worktree path, and workspace path
- `app/(board)/card-detail.test.tsx`: rewrote with a `renderDetail` helper wrapping every render in `<ToastProvider>` (CardDetail now consumes `useToast` via CopyField) + clipboard stub; +1 copy test

**Regressions:** none — wrapping detail renders in `ToastProvider` kept the existing 2 tests green. `app/(board)` + `src/lib` 13/13, tsc + biome clean.
**Notes:** Generic copy primitive reused as-predicted (Step 2 design paid off). Empty/null fields render no copy affordance (workspace/repos guarded).

## Quality Checkpoint (after steps 4–8): ✅ PASS

Quality-gate sub-agent verdict: pass, no fixes required. 4 Pillars verified (drag asserted by aria-roledescription proxy since PointerSensor isn't jsdom-drivable; literal href + literal copied value; clipboard stub + hoisted router mock + afterEach cleanup; rAF-aware findBy*). `resolveDetailCard` try/catch confirmed a single legitimate boundary. All files <300 lines (largest card-detail.ui.tsx 179), JSDoc complete, no stray `absolute`. Checks: `pnpm run test:run "app/(board)" src/lib` 13/13, tsc clean, biome clean.

**Follow-up (deferred to Slice G):** copy buttons are DOM descendants of the body `<a>` (functionally safe via stopPropagation, but invalid HTML / dev hydration warning). Will fix when reworking `card.ui.tsx` in Steps 19–20 — wrap only non-interactive content in the link.

### Step 9: Move status from the sheet (Slice D)

**Status:** ✅ Done
**Test Result:** red (no "Move to column" combobox) → green

**Tests (1 scenario; 4/4 in file passing ✅):**

1. ✅ Choosing a different column in the sheet calls `moveAction(card.id, Status.Done)`

**Files Changed:**
- `app/(board)/card-detail.ui.tsx`: added `MoveAction` type, `BOARD_STATUSES` (4 columns, no Archived), `StatusPicker` (Base-UI Select; no-op when re-picking the current column; `onValueChange` handles the `Status | null` arg); threaded optional `moveAction` through `CardDetail`→`CardDetailBody` (when present, the status row becomes the picker)
- `app/page.tsx`: inject `moveAction={moveCard}` into `<CardDetail>`
- `app/(board)/card-detail.test.tsx`: extended `renderDetail` with `moveAction`; +1 move test

**Regressions:** none. Reused existing `moveCard` verbatim (any→any UI transition + `revalidatePath`). `app/(board)` 12/12, tsc + biome clean.
**Notes:** Base-UI Select drove fine in jsdom via `findByRole("combobox")` → `findByRole("option")`. Board reflects the move via `revalidatePath("/")` (no separate optimistic state needed for the sheet).

### Step 10: `card_events` gains a `field_edit` kind — no migration (Slice E groundwork)

**Status:** ✅ Done
**Test Result:** test 1 red (`EditableField`/`emitFieldEditEvent` absent) → green; test 2 (legacy coalesce) green + verified red by temporarily disabling the `preprocess` (Sensitivity check).

**Tests (2 scenarios; 8/8 in file passing ✅):**

1. ✅ `emitFieldEditEvent` writes a field-edit row that reads back via `listCardEvents` with `kind: field_edit` + its `changes` diff
2. ✅ A legacy row physically lacking `kind` still parses (no migration), coalesced to `status_transition` with `from`/`to` intact

**Files Changed:**
- `src/cards/card-event.type.ts`: added `CardEventKind` + `EditableField` enums, `CardEventBase`, `FieldChange`, `StatusTransitionEventDocument`, `FieldEditEventDocument`; `CardEventDocument` is now the discriminated union of the two branches
- `src/cards/card.document.schema.ts`: replaced flat `cardEventDocumentSchema` with `z.preprocess(coalesce, z.discriminatedUnion("kind", [statusTransition, fieldEdit]))` — the preprocess injects `kind: status_transition` into rows missing it (Option A from the audit follow-up; no migration framework exists in the repo)
- `src/cards/card-event.service.ts`: `emitCardEvent` now stamps `kind: StatusTransition` internally (the 4 existing callers need no change); added `emitFieldEditEvent` (stamps `kind: FieldEdit`, success outcome, null error)
- `src/cards/card-event.service.test.ts`: +2 tests; narrowed the transition `.find` and chronological `.map` on `kind` (union no longer exposes `from`/`to` unconditionally)
- `src/cards/card.claim.service.test.ts`, `src/mcp/dispatch-tools.test.ts`: narrowed lenient `.find(e => e.to === ...)` predicates on `kind` (the flagged line-177-style breakage)

**Regressions:** none. `card-event` + `card.claim` + `dispatch-tools` suites 18/18, tsc + biome clean. `src/db/collections.ts` needed no edit — it imports `CardEventDocument` which is now the union (insertOne accepts either branch).
**Notes:** `emitCardEvent` stamping `kind` internally (vs. requiring each caller to pass it) kept the blast radius smaller than the audit follow-up predicted. No Option-B backfill script written (non-blocking data hygiene only; Option A makes legacy rows correct on read).

### Step 11: P0–P3 priority scale across the create flow (Slice E groundwork)

**Status:** ✅ Done
**Test Result:** each scenario red → green (schema accepted `5`; action dropped priority; form had no selector).

**Tests (3 scenarios; all passing ✅):**

1. ✅ `createTaskInputSchema` rejects an out-of-range priority (`5`, `-1`) and accepts an in-range one (`3`)
2. ✅ `createTaskAction` forwards the submitted priority to `createTask` (new `app/(board)/actions.test.ts`, mocks `createTask`/`revalidatePath`/`redirect`)
3. ✅ The add-task form offers a P0–P3 priority selector defaulting to P0 (combobox shows "P0"; opening reveals "P3")

**Files Changed:**
- `src/cards/card.schema.ts`: bound `createTaskInputSchema.priority` to `z.number().int().min(0).max(3).default(0)`. Document schema (`card.document.schema.ts`) intentionally LEFT permissive (`z.number()`) so legacy out-of-range cards still parse on read
- `app/(board)/actions.ts`: `createTaskAction` now reads `formData.get("priority")`, coerces via `Number(...)`, parses through the schema, and passes `parsed.data.priority` to `createTask` (previously dropped)
- `app/(board)/add-task-form.ui.tsx`: added a Base-UI `Select name="priority" defaultValue="0"` with P0–P3 items; `SelectValue` uses the function-child form `{(value) => \`P${value}\`}` because Base-UI renders the raw value (not the item label) while the popup is unmounted
- `app/(board)/actions.test.ts` (new): scenario 2
- `app/(board)/add-task-dialog.test.tsx`: +scenario 3
- `src/cards/card.schema.test.ts`: +scenario 1
- `src/cards/card.service.test.ts`: lockstep fix — the sort test's `priority: 5` → `3` (still sorts highest; 5 is now out of range)

**Regressions:** none. `app/(board)` 14/14 (7 files), `card.schema` + `card.service` green, tsc + biome clean.
**Notes:** Default new card = P0 (lowest), per locked decision #5. The form Select submits the value via Base-UI's `name` integration (hidden input), so the presentational form stays uncontrolled — no client state needed.

### Step 12: `updateTaskInputSchema` — explicit optional fields (Slice E groundwork)

**Status:** ✅ Done
**Test Result:** test 1 red (`updateTaskInputSchema` absent) → green; test 2 boundary coverage green-on-arrival (the schema constraints were defined atomically in test 1's GREEN).

**Tests (2 scenarios; 5/5 in file passing ✅):**

1. ✅ Accepts a partial patch (`{description}`) and an empty patch (`{}`) — the empty patch parses to `{}`, proving no `.default(0)` leaks in
2. ✅ Rejects empty title + out-of-range priority (`4`); accepts a blank `description` at the schema level (clearing is Step 14 service logic)

**Files Changed:**
- `src/cards/card.schema.ts`: added `updateTaskInputSchema` defined EXPLICITLY (`title: min(1).optional()`, `description: optional()`, `priority: int().min(0).max(3).optional()`) — deliberately NOT `createTaskInputSchema.partial()` (which would inherit priority's `.default(0)` and force priority to 0 on any untouched patch). Added `UpdateTaskInput` (`z.input`) + `ParsedUpdateTaskInput` (`z.output`) type aliases for Step 13
- `src/cards/card.schema.test.ts`: +2 scenarios under a new `describe("updateTaskInputSchema")`

**Regressions:** none. `card.schema` 5/5, tsc + biome clean.
**Notes:** The investigation flagged the `.partial()` + `.default(0)` trap (it was filed under v2 numbering as `INVESTIGATION_STEP_10.md`, which maps to v3 Step 12) — followed the explicit-fields recommendation.

## Quality Gate: After steps 9–12

### Test Quality
- **Score**: Good (close to Excellent)
- **Issues Found**: 2 (both minor, no fix applied — see below)
- **Issues Fixed**: 0
- **Details**:
  - Step 9: the "re-picking the current status is a no-op" AC has no test. Not fixable cleanly — the `Select` is controlled on `card.status`, so Base-UI itself suppresses `onValueChange` on a same-value pick; a test would pass for the wrong reason (low validity/reliability), so deliberately not added. The `next !== card.status` guard remains as defensive belt-and-suspenders.
  - Step 10: `FieldEditEventInput.changes` is typed `FieldChange[]` (allows `[]`) while `fieldEditEventSchema` enforces `.min(1)` — an empty-diff insert would write a row that fails read-back parse. Latent only; the actual diff-builder caller is Step 13, the natural enforcement point. Left as-is (changing it now would be speculative scope).
- Tests reviewed are otherwise strong: literal-value assertions (P0–P3 boundaries `5`/`-1`/`3`/`4`), semantic selectors (`findByRole("combobox"/"option")`), action-boundary verification (`toHaveBeenCalledWith({ priority: 2 })`), legacy-coalesce sensitivity-verified by the implementer (temporarily disabled `preprocess` → red). The chronological read-back narrows the union via a typed filter before mapping `from`/`to`.

### Code Quality
- **Refactoring Applied**: no
- **Changes Made**: none needed. JSDoc present on all functions; types hoisted; enums used; discriminated unions correctly modeled; files all <300 lines (largest changed file `card-detail.ui.tsx` at 251).

### Overall
- **Quality**: pass
- **Notes**: tsc clean, biome clean, all affected suites green (board 14/14; card-event 8/8; schema 13/13 combined; lockstep suites card.service + card.claim + dispatch-tools 25/25). The two minor findings are documented for Step 13 to absorb (the `changes` `.min(1)` mismatch in particular); neither blocks.

### Step 13: `updateTask` patches only changed fields + bumps `updatedAt` + emits field-edit audit (Slice E groundwork)

**Status:** ✅ Done
**Test Result:** test 1 red (`card.edit.service` module absent) → green; tests 2 (audit diff) & 3 (empty-patch guard) green-on-arrival from test 1's atomic implementation.

**Tests (3 scenarios; 3/3 in file passing ✅):**

1. ✅ Patches only the provided fields (title + priority), leaves description untouched, bumps `updatedAt`
2. ✅ The field-edit audit event captures only the fields that actually changed (re-passing the same description is excluded from the diff)
3. ✅ An empty patch bumps `updatedAt` only and emits NO field-edit event (the non-empty-diff guard)

**Files Changed:**
- `src/cards/card.edit.service.ts` (new): `updateTask(id, patch)` — `updateTaskInputSchema.safeParse` → `ErrorCode.Validation` on failure; read pre-image via `findOneZ`; `diffFields(before, parsed)` computes the per-field diff (only present-AND-different fields); `findOneAndUpdateZ($set provided keys + updatedAt, returnDocument: "after")`; `emitFieldEditEvent` **only when `changes.length > 0`** → `toClientCard`. Mirrors the `setWorkspace` pattern. Helpers: `toAuditValue` (undefined→null, else `String(v)`), `diffFields`.
- `src/cards/card.edit.service.test.ts` (new): 3 integration scenarios with `beforeEach deleteMany` on cards + card_events.

**Regressions:** none. 3/3, tsc + biome clean.
**Notes:** Absorbed the quality-gate's flagged `FieldChange[]`/`.min(1)` mismatch — `updateTask` is the only `emitFieldEditEvent` caller and guards on a non-empty diff, so a zero-change row is never written. NotFound handled (pre-image read + post-update both guard). Audit caller is `Caller.Ui` (the only edit surface so far). Blank-description `$unset` is deliberately NOT here — that is Step 14.

### Step 14: Blank description `$unset`s the field (Slice E)

**Status:** ✅ Done
**Test Result:** red (blank stored as `""`, read back as `""`) → green (field removed, reads back `undefined`).

**Tests (1 scenario; 4/4 in file passing ✅):**

1. ✅ Editing with a blank description clears the field — both the returned card and a fresh `getTask` read back `description: undefined` (not `""`)

**Files Changed:**
- `src/cards/card.edit.service.ts`: the update doc now routes a blank description to `$unset: { description: "" }` (never `$set` + `$unset` the same field) — built immutably by destructuring `description` out of `parsed.data` and conditionally re-adding it to `$set` only when non-blank. `diffFields` normalizes a blank description to "absent" so the audit records `to: null` and clearing an already-absent description is a no-op. Imported `UpdateFilter` from mongodb.
- `src/cards/card.edit.service.test.ts`: +1 scenario; imported `getTask`.

**Regressions:** none. 4/4, tsc + biome clean.
**Notes:** `findOneAndUpdateZ` passes the full `UpdateFilter` straight to `findOneAndUpdate`, so `$unset` works unchanged. `cardDocumentSchema.description` is `.optional()`, so the after-image (field absent) parses cleanly.

### Step 15: Inline edit in the sheet — title/description/priority (Slice E)

**Status:** ✅ Done
**Test Result:** scenario 1 red (no Edit button) → green; scenario 2 (cancel) green.

**Tests (2 scenarios; card-detail 6/6 ✅):**

1. ✅ Entering edit mode, changing the title, and saving calls `editAction(card.id, { title, description, priority })` with the full field patch
2. ✅ Cancelling the edit form calls nothing and returns to the read-only view (Edit button reappears)

**Files Changed:**
- `app/(board)/card-detail.state.tsx` (new): `createReducerContext` for `{ isEditing }` + domain hooks `useCardEditMode`/`useCardEditActions` (startEdit/cancelEdit) + `CardEditProvider`
- `app/(board)/card-detail-edit.ui.tsx` (new): `CardEditForm` (title Input, description Textarea, P0–P3 priority Select) — uncontrolled, reads `FormData` on submit, calls the injected `EditAction`, then `cancelEdit()`. Exports the `EditAction` type
- `app/(board)/card-detail.ui.tsx`: `CardDetailBody` consumes `useCardEditMode`; edit mode swaps the read-only description+priority rows for `CardEditForm`; an Edit button enters edit mode when `editAction` is injected. `CardDetail` wraps its body in `CardEditProvider` and accepts `editAction`. (292 lines — under the 300 ceiling; the form was extracted to a sibling file to stay under)
- `app/(board)/actions.ts`: `updateTaskAction(cardId, patch)` → `updateTask` + `revalidatePath("/")`
- `app/page.tsx`: inject `editAction={updateTaskAction}`
- `app/(board)/card-detail.test.tsx`: +2 scenarios; `renderDetail` gains `editAction`

**Regressions:** none. `app/(board)` 19 tests + `card.edit.service` = 20/20 across 8 files, tsc + biome clean.
**⚠️ Conscious deviation from plan wording:** Step 15 specified `useOptimistic` for immediate reflect. Implemented WITHOUT it — the edit persists and the open sheet re-reads fresh values via `revalidatePath("/")` (the page re-runs `resolveDetailCard`). The behavior (edit → persist → reflect) is fully met; `useOptimistic` would only hide the round-trip's brief visual lag and adds fragile wiring around a form that collapses on save. Flagged for user review at the Slice E boundary — easy to add later if the lag is undesirable on-device.

**✅ Deviation resolved (post-checkpoint):** `useOptimistic` is now implemented. `CardEditForm` uses a React form `action` (runs in a transition); `CardDetailBody` holds `useOptimistic(card, (cur, patch) => ({...cur, ...patch, description: patch.description || undefined}))` and a `handleSave` that applies the patch optimistically before awaiting the injected `editAction`. The displayed card (header title, description, priority) renders from `optimisticCard`, so an edit shows immediately and settles on the revalidated server prop. New test: "optimistically reflects the edited title while the save is in flight" (holds the action pending, asserts the heading shows the new title) — card-detail 7/7. To keep `card-detail.ui.tsx` under 300 after the additions, `StatusPicker` + `MoveAction`/`STATUS_LABELS` were extracted to `app/(board)/card-detail-status.ui.tsx` (card-detail.ui now 263 lines).

### Slice F — Archive (Steps 16–18)

**Status:** ✅ Done (all red→green, tsc + biome clean, `app/(board)` 19/19, full suite green)

**Step 16 — `Status.Archived` + `deleteTask`:**
1. ✅ `deleteTask(id)` archives a card (status → `archived`) and records a success transition in the audit log
- `src/cards/card.type.ts`: added `Status.Archived = "archived"` (soft-delete, not a board column)
- `src/cards/card.edit.service.ts`: `deleteTask(id)` = `updateTaskStatus(id, Status.Archived, { caller: Ui })` — reuses the any→any UI transition + its audit, no transition-policy change
- `app/(board)/card-detail-status.ui.tsx`: added `[Status.Archived]: "Archived"` to `STATUS_LABELS` (exhaustive `Record<Status>`); `BOARD_STATUSES` deliberately still excludes it (move picker never offers Archived)
- `src/cards/card.schema.test.ts`: lockstep fix — the old "`archived` rejected" assertion flipped to "`archived` parses" (+ a `not_a_status` rejection)

**Step 17 — archived excluded from board default:**
1. ✅ `listTasks()` (no filter) hides archived cards; `listTasks({ status: Archived })` still returns them
- `src/cards/card.service.ts`: default branch sets `query.status = { $ne: Status.Archived }`; explicit-status path unchanged. (Test written robust to the shared-state `listTasks` describe — asserts membership, not exact list.)

**Step 18 — confirm-to-archive in the sheet:**
1. ✅ Confirming archive calls `deleteAction(card.id)` and closes the sheet (`router.replace("/")`)
2. ✅ Cancelling the confirm does not call the action
- `app/(board)/card-detail-archive.ui.tsx` (new): `ArchiveControl` — destructive button → Base-UI `AlertDialog`. `AlertDialogAction` is a plain Button (not a Close), so confirm wires via its `onClick` → `deleteAction` then `router.replace(boardHref())`; double-submit guarded with a `pending` flag. Trigger label "Archive", confirm "Archive card" (distinct for tests/a11y). No toast.
- `app/(board)/card-detail.ui.tsx`: Edit + Archive grouped in an actions row in the read-only branch; threads `deleteAction` through (277 lines, <300)
- `app/(board)/actions.ts`: `deleteTaskAction(cardId)` → `deleteTask` + `revalidatePath("/")`
- `app/page.tsx`: inject `deleteAction={deleteTaskAction}`
- `app/(board)/card-detail.test.tsx`: +2 scenarios; `renderDetail` gains `deleteAction`

**Note:** archive is a soft-delete (recoverable, audit intact), per the locked planning decision (not hard-delete). `OPEN_STATUSES` (the dedupe partial index) unchanged — archiving frees a card's `dedupeKey` since archived ∉ open statuses.

### Slice G — Tile enrichment + empty-tile clean state (Steps 19–20)

**Status:** ✅ Done (all red→green, tsc + biome clean, full suite 106/106 across 29 files)

**Relative-time helper (Step 19 groundwork):**
1. ✅ `formatRelativeAge(iso, now)` formats a past timestamp ("2 days ago")
2. ✅ Picks coarser units as the gap widens ("3 hours ago")
- `src/lib/relative-time.ts` (new): pure helper over `Intl.RelativeTimeFormat` with a divisions table; `now` injected for determinism. `src/lib/relative-time.test.ts` (new).

**Step 19 — populated tile enrichment:**
1. ✅ Description preview (`tile-description`, `line-clamp-2`)
2. ✅ Primary repo·branch chip with `+N` overflow (`tile-repo`)
3. ✅ Recurring marker for recurring origin (`tile-recurring`, `role="img"` `aria-label="Recurring"`)
4. ✅ Relative age from `pickedAt ?? createdAt` (`tile-age`; test proves pickedAt wins over a month-old createdAt)
- `app/(board)/card.ui.tsx` (rewritten, 84 lines): two sibling `<Link>`s (the `#number` and the body) around non-interactive content; conditional enrichment chips with stable `data-testid` handles; `now?: Date` prop defaults to render time, injected in tests.
- `app/(board)/card.test.tsx` (new): 5 scenarios (incl. Step 20).

**Step 20 — empty tile stays calm:**
1. ✅ An empty card (no description, no repos, manual origin) renders number + priority + title and NONE of the enrichment chips (`queryByTestId(...).not.toBeInTheDocument()` for description/repo/recurring). Age is treated as universal baseline (every card has a timestamp), so it is not gated.

**🔧 Deferred issue FIXED (button-in-anchor):** the 4–8 quality-gate flagged that `CopyDispatch` (a button + menu) was nested inside the body `<Link>` (invalid HTML). Resolved here: `CardTile` now owns its navigation links around non-interactive content only, and the wrapper `<Link>` was removed from `app/(board)/draggable-card.ui.tsx` (it now renders `<CardTile>` directly). `draggable-card.test.tsx` still green (its "body is a link" test keys off the tile's internal body link).
