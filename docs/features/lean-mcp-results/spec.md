# Lean MCP results

The MCP card tools return only what the caller does not already have. Writes acknowledge instead of echoing the card, reads default to a resume-sized view, and decision entries have a length ceiling.

## Why

Card tool results were 31.6% and 43.1% of *all* tool output in two measured sessions. The cause was `toCardResult`: every write returned the entire card, so each write cost more than the last as the card grew.

Measured on one real pre-compact flush (session `4b1e7be6`, card #172, six consecutive writes):

- The writes' **arguments** totalled 1,430 tokens — the actual new information.
- Their **echoes** totalled 38,416 tokens. A 27:1 ratio.
- Echo sizes in call order: 5641 → 5964 → 6254 → 6597 → 6940 → 7020, each a superset of the last. Even if the whole card were wanted, it was needed **once**; 31,396 tokens were re-transmission.
- Of the final 7,020-token echo: `decisions` 4,672 (16 entries, mean 292 tokens), `progress` 1,929, everything else ~420. **1,139 tokens sat in 4 decisions already marked outdated.**

## Behaviours

### A write acknowledges; it does not echo

Every write tool returns `{ id, number, status, decisionCount, progressCount }` — about 27 tokens, flat regardless of card size.

Each field is there because the caller cannot infer it: `id`/`number` because `create_card` and `claim_card` mint them, `status` because a write can change it as a side effect, and the counts as cheap confirmation the append landed (and a way to notice another writer). Everything else was either unchanged by the write or supplied *by* it.

Applies to `claim_card`, `create_card`, `update_card`, `append_progress`, `append_decision`, `mark_decision_outdated`, `set_status`, `adopt_card`, `set_workspace`, `set_my_status`.

Error results are unchanged: `ERR_*` code and message, exactly as before.

### A read defaults to what a resuming session needs

`get_card_context` and `get_my_task` take `view`, defaulting to the resume shape:

- header (`id`, `number`, `title`, `status`, `nextAction`, `workspacePath`, `repos`, `tags`)
- **still-current** decisions only, each as `{ index, decision }`
- the **newest** progress note
- `omitted: { outdatedDecisions, earlierProgress }` so the reader knows there is more

Superseded decisions, every `why`, earlier progress notes, the description and the metadata tail are withheld.

`view: "decisions"` returns the decision log in full — every entry with its `why` and supersession links — for following up on reasoning the resume view withheld, without buying the rest of the card.

`view: "full"` returns the entire card, field for field as before this feature existed.

**Each resume decision carries its original array index.** Decisions are addressed positionally and the resume view filters superseded ones out, so without the index a resuming agent would aim `mark_decision_outdated` at the wrong entry.

### An over-long decision is refused with its actual length

`append_decision` rejects a `decision` over 200 characters or a `why` over 400 with `ERR_VALIDATION`, naming both the actual length and the limit. Nothing is persisted. An entry sitting exactly on either limit is stored whole.

Rejection is deliberate: a warning changes nothing, and truncation loses the tail silently. Naming the length is what lets the agent rewrite rather than retry the same entry.

Entry length is the second multiplier on read cost — card #172 averaged 292 tokens per decision where card #141 managed 105 under the identical schema.

## Key files

- [src/mcp/tools.ts](../../../src/mcp/tools.ts) — `toCardAckResult`, `toCardResumeResult`, `toCardDecisionsResult`, `toCardResult`; `createGetMyTask`, `createSetMyStatus`
- [src/mcp/dispatch-tools.ts](../../../src/mcp/dispatch-tools.ts) — the 9 dispatch writes and `createGetCardContext`'s view switch
- [src/mcp/dispatch-server.ts](../../../src/mcp/dispatch-server.ts) / [src/mcp/server.ts](../../../src/mcp/server.ts) — `view` registered in both tools' `inputSchema`
- [src/cards/card.schema.ts](../../../src/cards/card.schema.ts) — `cardViewSchema`, `DECISION_MAX_LENGTH`, `DECISION_WHY_MAX_LENGTH`
- [src/cards/card.decision.service.ts](../../../src/cards/card.decision.service.ts) — length enforcement
- [src/cards/card.type.ts](../../../src/cards/card.type.ts) — `CardView`

## Notes for whoever changes this next

**A `view` param must be registered in `registerTool`'s `inputSchema`, not just accepted by the handler.** The MCP SDK silently drops unknown arguments rather than rejecting them, so a handler-level suite can be entirely green while the param is unreachable over a real client. `dispatch-server.test.ts` guards this by calling through a connected client with a bogus view and requiring `Input validation error`.

**Length limits live in the service, not in `decisionTextSchema`.** A `.max()` on the schema would reject at the MCP boundary with a generic message and lose the actual length.

**Tests that verify persistence must read back with `view: "full"`.** Several previously asserted stored state off a *write* result; that only worked because writes echoed.

**The 200/400 limits have consumers outside this repo.** Seven skill files in `AI-rules-repo/skills/claude-code/` state the numbers and instruct agents on the rejection: `pre-compact-flush`, `feature-dev-lite`, `orchestrated-feature-dev` (SKILL + `nodes/node-plan.md` + `nodes/node-bdd-step.md`), `ai-kanban-work-card/steps/3-work-and-complete.md`, `ai-kanban-track-session/steps/2-track-progress.md`. Change a limit here and those must move with it, or agents will be told a number the server no longer enforces.

**Adding this rejection nearly caused silent data loss, and the trap generalises.** Every one of those skills already said the card mirror was best-effort — "never block the work on a mirror failure", "on failure, note it and keep working". That was written for a *transport* failure, but an `ERR_VALIDATION` refusal is indistinguishable from one at the instruction level, so an agent would have discarded the over-long decision and moved on. The skills now name the exception explicitly. **When you add a rejection to an API, audit every caller that was previously told to ignore failures** — a new error class inherits the old error-handling policy by default, and "ignore" is the wrong policy for "fix this and retry".
