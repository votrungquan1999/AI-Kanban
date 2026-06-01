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
