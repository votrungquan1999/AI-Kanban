---
name: orchestrated-feature-dev
description: Orchestrated multi-phase feature development — sub-agent phases (research, plan, investigation, implementation-blind behavior-risk catalog, batched BDD, conformance + adversarial verification) with quality-gate and human-approval loops. Use for large or high-stakes features where the full rigor is wanted: explicit planning, test-first BDD, and adversarial verification of the un-specified space. Trigger on "orchestrated development", "structured/deep feature build", "full development pipeline", or when asked to build a complex feature end-to-end with tests and review gates. Do NOT use for quick edits or single-step changes — the gated pipeline is overkill there.
metadata:
  subagents: blocker-check
---

# Orchestrated Feature Development

The main session is an **orchestrator**: it spawns a sub-agent for every working phase (it does none of the work itself), passes data between phases through state files in a per-task workspace, and routes based on what each sub-agent returns. Each node file under `nodes/` holds the *how* for one phase; this file holds only *what to spawn, what to pass, and how to route*.

Pipeline: research → plan → (investigation ∥ behavior-risk catalog) → BDD-batch ↔ quality-gate → (conformance ∥ adversarial verification) → mutation pass → summary.

## Orchestrator Rules

- **Delegate everything.** Never research, plan, investigate, catalog, implement, or verify in the main session — spawn the node sub-agent. Delegation (not model choice) is what keeps the orchestrator a lean router.
- **Batch to the cap.** For investigation, BDD, and verification, put **as many related behaviors as possible into one sub-agent, capped at 4** (group by shared files/module) — one agent amortizes the shared-context read across its behaviors, but beyond ~4 its context congests and quality drops. Spawn a phase's batches in a single message so they run in parallel.
- **Route on returns.** Route on each sub-agent's report and relay it to the user. Beyond the reads and edits a phase below names, read only the small routing files (`COMMIT_PLAN.md`, `MUTATION_PLAN.md`, `PLAN_STEPS.md` status lines) — anything you read is paid again on every later turn. Do not re-analyze findings in your own words.
- **Rewrite options and questions in plain words.** Relay findings as returned, but every option or question put to the owner says in plain words what it does and what changes.
- **Give every id a plain title.** Ids like `R1` (a catalog entry) or `D4` (a decision entry) are for lookups inside `<ws>`; every id shown to the owner has its plain title next to it (`R3 — archiving a card already in review`).
- **Read code only to settle a disagreement.** When two agents disagree (implementer vs blocker check, BDD agent vs quality gate), read only the disputed spot or put both sides to the operator — and go to the operator whenever that spot cannot settle it. Reading code on every return refills the context the delegation saves.
- **A verification screen gets no polish.** A screen built only so the owner can check a feature by hand is a tool, not a product: leave polish findings on it (loading flashes, rare edge states, nearly unreachable errors, cosmetic races) and list them once as known limits; fix only what stops the check or shows wrong data.
- **The plan owns the behavior → step tree.** `PLAN_STEPS.md` mirrors `implementation-plan.md` title-for-title (`Behavior N`, `Step N.M`) and only adds build detail. Change a behavior or step in the plan first, then mirror it; once `PLAN_STEPS.md` exists, after any edit you make to either file, run the command below and fix every title it prints before routing on (empty output = match; needs bash/zsh) — a silent mismatch builds something you never reviewed.

  ```
  diff <(grep -E '^(#+ |- \[[ xX]\] )(Behavior [0-9]+|Step [0-9]+\.[0-9]+):' <ws>/implementation-plan.md | sed -E 's/^(#+ |- \[[ xX]\] )//') <(grep -E '^(#+ |- \[[ xX]\] )(Behavior [0-9]+|Step [0-9]+\.[0-9]+):' <ws>/PLAN_STEPS.md | sed -E 's/^(#+ |- \[[ xX]\] )//')
  ```
- **Freeze `BEHAVIOR_RISKS.md`** once Phase 3b writes it — the adversarial phase checks against it; never edit it to match what was built.
- **Serialize git.** Under the `per-behavior` commit strategy, never spawn BDD batches in parallel — concurrent sub-agents committing to one branch corrupt each other's history, and batches are grouped by *shared files*, so one file's diff cannot be split across behaviors after the fact. Run batches one at a time. Verification (Phase 5) stays parallel because those sub-agents only report; the single fix sub-agent does the git work.
- **Mutation testing happens in Phase 5c or not at all.** No phase mutates source to check a test — not the BDD loop, not the quality gate, not conformance. Judging sensitivity by reading is every other phase's job; the one pass that injects real defects is budgeted, runs alone, and uses `nodes/mutation-harness.py`. Never write mutation instructions into a sub-agent prompt yourself.
- **Time-box sub-agent test runs.** Every brief for a sub-agent that runs tests or lint wraps the command in a hard timeout (e.g. `timeout 900`). On a 'waiting on its own background work' notice, check the process age at once and kill only our own hung PIDs past ~2x the expected time.
- **Log decisions.** Whenever any phase or the orchestrator faces **2+ viable options and picks one** (including choices the user resolved), append to `<ws>/DECISIONS.md`: chosen option, alternative(s), one-line why, and `card#<N>` once mirrored (below). Skip forced moves.
- **Mirror decisions to the card (best-effort).** The `DECISIONS.md` write is the trigger: for every NEW entry call `append_decision(cardId, { decision, why? })` so the "why" outlives `<ws>`. Resolve `cardId` from the session pointer `~/.claude/kanban-session-state/$CLAUDE_CODE_SESSION_ID.json` (`cardId` field); if the file/field is absent, **skip silently**. The reply carries `decisionCount`; the entry's 0-based index is `decisionCount - 1` — write it into that `DECISIONS.md` entry as `card#<N>` (never derive it from the D-number). If the entry **supersedes** an earlier one, call `mark_decision_outdated(cardId, N)` with the earlier entry's stored `card#N` **first**, trusted without a confirm-read, then append, so a mid-way failure never leaves two contradictory active entries; if the tag is missing, match the older text via `get_card_context` and skip the mark if ambiguous; an entry never mirrored needs no mark. On a failed call, retry only the failed call — never re-send an append that already succeeded. **Send any card write in the same message as the next action that does not depend on it** (a spawn, a user message) — a turn of its own re-reads the whole context — but never with a gate or question whose answer decides the card text; the `card#N` tag edit and the `lastMirroredAt` re-stamp ride along the same way. After a successful mirror, re-stamp `lastMirroredAt` in the session pointer (skip if the call failed, so the debt stays visible). Mirror only new entries. Every call is non-blocking — on failure, note it and keep working — **except** `ERR_VALIDATION`: `decision` is capped at 200 characters and `why` at 400, and the error names the actual length; rewrite shorter and call again, or the entry never reaches the card.

**Spawn pattern** — keep the prompt minimal; the node carries the instructions:

```
Agent(
  description: "[phase] [assignment]",
  model: [see lever],
  prompt: "Read [skill dir]/nodes/node-X.md and execute it. Workspace <ws> (./tmp/<identifier>/).
    [Assignment: which behaviors/risks, which state files to focus on.]
    Report back: [what the orchestrator needs to route]."
)
```

**Model lever** (per-call `model`: `"haiku"|"sonnet"|"opus"`; `"sonnet"` = current Sonnet 5). `CLAUDE_CODE_SUBAGENT_MODEL` overrides all.
- Orchestrator, research, plan, quality-gate and its re-check, **behavior-risk catalog** → default (Opus) — full/adversarial judgment.
- Investigation, BDD, both verification passes, **mutation pass** → `"sonnet"` (Sonnet 5 is strong enough; keeps the main session lean).
- Fix sub-agents (5a conformance fixes with their commit folding, 5b fixes to an existing behavior) → `"sonnet"` — applying a stated fix needs no deep judgment.
- Blocker check → `"opus"` — it must out-reason the agent it second-guesses (the `blocker-check` agent type also sets this itself).
- Living spec writer → default — a cheaper model fabricates and inverts spec content.
- Spec check → `"sonnet"`.
- Summary → `"haiku"` (the summary only, never the spec).

## Task Workspace & State Files

Every run is scoped to a **task identifier** (a ticket id, or a kebab-case slug derived from the request). All state lives in `<ws>` = `./tmp/<identifier>/`, so parallel tasks never collide. Establish it in Phase 0 and pass its path into every sub-agent. `./tmp/` is gitignored; delete the folder when done.

- `RESEARCH_OUTPUT.md` — research findings (+ `RESEARCH_FOLLOWUP_[id].md`, folded in by its own agent)
- `implementation-plan.md` — the plan the user reviews (Technical Design + Behaviors)
- `PLAN_STEPS.md` — the plan's behavior → step tree with build detail (acceptance mode, files, notes, status per behavior and step); workflow state, **not** for user review, written only after the owner approves the plan. `N` in every `_STEP_[N]` file name is the behavior number
- `INVESTIGATION_STEP_[N].md` — per-behavior investigation context
- `BEHAVIOR_RISKS.md` — implementation-blind behavior-risk catalog (Phase 3b); **frozen** after
- `IMPLEMENTATION_PROGRESS.md` — per-behavior results + red/green (or pinned-green) audit trail
- `VALIDATION_STEP_[N].md` — conformance results (5a); `ADVERSARIAL_REVALIDATION.md` — adversarial findings (5b)
- `MUTATION_PLAN.md` — whether Phase 5c runs, and its budget; `MUTANTS.json` + `MUTATION_RESULTS.md/.json` — the pass's inputs and findings
- `DECISIONS.md` — running decision log (each new entry is also mirrored to the AI-Kanban card — see **Mirror decisions to the card**)
- `COMMIT_PLAN.md` — the commit strategy, base SHA, and behavior→commit-subject map (see `nodes/commit-protocol.md`)
- `QUALITY_GATE_<N>_FIXES.md` — a quality gate's findings + fix diffs, read by its re-check; `N` = the last behavior the checkpoint covers

---

## Phase 0: Establish Workspace

Derive the task identifier (a ticket id from the request or branch, else a kebab-case slug from the request) and state it in one line. Create `./tmp/<identifier>/`. **Gate:** do not proceed until it exists. **Before creating it, check whether `./tmp/<identifier>/` already holds artifacts from unrelated work — if so, STOP and ask the user** rather than overwriting another task's run.

The identifier doubles as the `<slug>` for the feature's living spec (`docs/features/<slug>/spec.md`, written at Phase 6). If a spec already exists for this `<slug>`, skim it first as recall context — this run **updates** that same living spec rather than starting fresh.

**Drop the spec-reminder sentinel (best-effort).** Write `{ slug, specPath: "docs/features/<slug>/spec.md" }` to `~/.claude/spec-reminder-state/$CLAUDE_CODE_SESSION_ID.json`. This is what the `spec-reminder` Stop hook reads to nudge you, at session end, to update the living spec before wrapping up. Skip silently if `$CLAUDE_CODE_SESSION_ID` is unset.

## Phase 1: Research (convergence loop)

Spawn `node-research.md` as the INITIAL agent → writes `RESEARCH_OUTPUT.md`. While its "Follow-up Investigations Needed" is non-empty, spawn one follow-up agent per item (parallel); each folds its own notes into `RESEARCH_OUTPUT.md`, and you build the next round from the items the agents return. Stop when a round returns no new items or after **3 rounds**. Then present findings + only the genuine Open Questions.

**Settle the test level here.** Read the `Testing Patterns` block of `RESEARCH_OUTPUT.md`. The BDD loop defaults to the **integration level** — real flow, real collaborators, asserted at the client-facing entry point — because a mocked unit test stays green while the wiring, transaction, serialization, or permission check is broken.

- **A harness exists** → note `Test level: integration via <harness>` in `DECISIONS.md`, and pass the harness, its command, and the example file to mirror into every BDD sub-agent prompt. No question needed.
- **`none found`** → **ask the user now, in the same message as the gate.** This is the cheapest moment: the plan isn't written, so harness setup can still be planned in rather than retrofitted after ten mocked tests. Offer: **stand one up** (name the concrete setup and its cost — it becomes the first steps of the first behavior that needs it, never a heading of its own), **point you at one you missed**, or **accept unit-level for this feature** (wiring goes unverified). Never let a run fall back to mocked unit tests without that answer, and never invent containers or a browser runner unasked.

Record the resolution in `DECISIONS.md`, mirror it to the card, and pass it to `node-plan.md`.

**Gate:** ask "continue to planning, or investigate more?" — plus the test-level question when the verdict was `none found` — and wait for explicit continue.

## Phase 2: Plan

Spawn `node-plan.md` (reads `RESEARCH_OUTPUT.md`, loads the `create-implementation-plan` skill) → writes `implementation-plan.md`.

**Check the format before presenting.** `implementation-plan.md` must carry `## Technical Design` and `## Behaviors to Implement`, one `### Behavior N` heading per behavior with its checklist (test-first checkboxes, or its steps). A plan shaped as an `AC:` / `Test Type:` step list means the sub-agent never loaded the skill — send it back to a fresh sub-agent rather than presenting it. So does a heading that fails the behavior check in `nodes/node-plan.md` — setup, cleanup or a verification run as its own heading, or a heading with no acceptance check of its own ("no new test", "existing tests stay green") outside the unchanged-outcome mode. Judge it from its headings (`grep -E '^#{2,3} ' <ws>/implementation-plan.md`) and the planner's report rather than a full read. Then present a markdown link to `<ws>/implementation-plan.md` (never `PLAN_STEPS.md`), the numbered `Behavior N` titles from that grep (one line each, with its stakes and reason), any architecture options waiting on the owner's pick, and any questions the plan could not settle from the requirements. Say the owner can change any behavior's stakes in the same reply. Never paste the plan into the chat — the operator reads the file, and pasting it costs the context twice.

**Gate:** do not proceed until the user approves the plan. Then spawn `node-plan.md` in steps mode → writes `PLAN_STEPS.md` from the approved plan (with any stakes the owner changed); Phase 3 starts when it returns.

## Phase 3: Investigation (batched parallel)

Spawn `node-investigation.md`, one sub-agent per batch (batch to the cap), each assigned its behaviors → writes `INVESTIGATION_STEP_[N].md` per behavior. On return, spawn `node-plan.md` in revise mode with the list of `INVESTIGATION_STEP_*.md` files — it folds the findings into both plan files and returns a change list grouped as problems + fixes. Relay that list as returned, then present the link + `Behavior N` titles as in Phase 2.

**Gate:** wait for approval of the updated plan.

## Phase 3b: Behavior-Risk Catalog (implementation-blind, parallel with Phase 3)

Spawn `node-behavior-risk.md` (may go in the same message as the investigation batches). It catalogs edge-case **behaviors** from the requirement + existing system only — **never** the new implementation — into `BEHAVIOR_RISKS.md`. On return:

1. **Sort requirement-silent entries now**, cheaper to resolve before implementation than after:
   - **Small rules** (ties, thresholds, report formats) → decide, record each in `DECISIONS.md` (and mirror it to the card), and list them in your next message to the owner.
   - **Decisions the owner would notice** (what users see, money, data) **and architecture choices** → ask the owner.

   Fold each resolution into `implementation-plan.md` (then mirror it into `PLAN_STEPS.md` if it adds a behavior or step); log to `DECISIONS.md` (and mirror it to the card).
2. **Freeze the catalog** — requirement-implied entries become the Phase 5b checks; `BEHAVIOR_RISKS.md` is now immutable.

**Gate:** if any silent entry went to the owner, wait for those decisions.

## Phase 4: Implementation Loop

**4·0. Run options — before any code is written.** The behavior list is final now (Phase 3b may have added behaviors), so this is the last moment the answers are stable. In one message:

**a. State the commit strategy — do not ask.** One commit per behavior, fixes folded into the owning commit: each behavior is committed as soon as it goes green, and every later fix (quality gate, conformance, adversarial) is folded back into the commit that owns that behavior, so the branch ends with exactly one commit per behavior in the plan. Say plainly that folding **rewrites history**, so it is only free while the branch is unpushed. If the owner asks for another approach, follow it; when they want to commit everything themselves, record `Strategy: defer` (the run never touches git).

**b. Run a mutation pass?** One budgeted Phase 5c pass that injects defects to prove the tests would catch them. Quote the real trade: on a past run it surfaced **8 false-green tests** the other phases missed, and the budgeted version costs roughly **10-20 minutes**. Default **on** when any behavior is `high` stakes; **off** otherwise.

Write the commit strategy to `<ws>/COMMIT_PLAN.md` per `nodes/commit-protocol.md` and the mutation answer to `<ws>/MUTATION_PLAN.md` (`Mutation: on|off`, plus the budget if it differs from the default ≤3 per behavior / ≤30 per run). Log both to `DECISIONS.md` and mirror them to the card. **Gate:** do not spawn the first BDD batch until the operator has answered the mutation question. Pass the commit strategy into every sub-agent you spawn from here on.

Batched BDD sub-agents alternate with quality gates. Run the approved plan end to end: after a batch and its quality gate, start the next batch without pausing for the operator's sign-off; stop only for the gates and blockers routed below, or when the operator says stop.

**4a. BDD batch** — spawn `node-bdd-step.md` per batch (batch to the cap; same grouping as investigation). **The execution unit is the behavior:** one node run delivers one behavior and all its steps under its acceptance mode, one test at a time with meaningful-red discipline, and **bubbles up** on any gate. Route on its return:
- **Done, no gate** → quality gate (4b), then next batch.
- **Stopped at a gate, or any sub-agent (investigation, BDD, fix, mutation) reporting a factual blocker** (untestable behavior, failing harness, missing dependency, a failure it cannot resolve, "can't be done because X") → spawn `node-blocker-check.md` before asking the operator. Brief it with the claim, the files and commands the reporting agent named, the project's test command and the env facts it needs, the verbatim text of any rule the claim cites (the checker has no rules loaded), and always this safety set: the project's own test command only, no paid API calls, never `pkill` by pattern, nothing destructive — never the reporting agent's reasoning. Use `subagent_type: "blocker-check"` only if the Agent tool lists it **and** `claude --version` (run once per session) reports ≥ 2.1.271, because older versions ignore its `omitClaudeMd` and load the rules; otherwise `subagent_type: "Explore"`, model per the lever. Route its verdict: `refuted` → re-spawn the reporting agent's work with the refutation and any fixable path in the brief (one round per claim; the same claim again goes to the operator); `confirmed` → escalate to the operator with the evidence; `inconclusive` → escalate to the operator with what the checker tried; either way, handle the answer as in the next bullet.
- **Stopped at a gate on anything else** (2+ defensible behaviors the owner would notice, an architecture choice, a pushed-commit or rebase problem) → escalate to the user directly, log to `DECISIONS.md` (and mirror it to the card), then spawn a **new** sub-agent to resume that batch with the decision baked in.

**4b. Quality gate** — every **2-3 completed behaviors**, spawn `node-quality-gate.md`. `pass` → next batch. `fixed` → the gate fixed its findings itself and wrote `<ws>/QUALITY_GATE_<N>_FIXES.md`; spawn `node-quality-gate.md` again naming that file, which re-checks only those fixes (**max 2** re-checks per checkpoint; still not `pass` after the 2nd → operator). `blocked` → re-run that behavior's BDD batch with the finding in its brief, or ask the operator when it needs a design or product call or is a git-history problem.

**4c. Final check** — if `PLAN_STEPS.md` has a `## Final check`, spawn one `node-bdd-step.md` sub-agent for it once every behavior is done. It runs the check and records the result; it changes no code. A failure routes like a stopped gate, factual blockers through the check above.

**Terminate** when all planned behaviors are done, the user says stop, or the behavior count exceeds 20.

## Phase 5: Verification (batched parallel)

Two independent axes, spawned together so all run in parallel:

**5a. Conformance Validation** — "did each behavior match the plan?" Spawn `node-validation.md` per behavior-batch (to the cap) → `VALIDATION_STEP_[N].md`.

**5b. Adversarial Revalidation** — "does the code survive the frozen catalog?" Spawn `node-adversarial-revalidation.md` per risk-group (related risks together) → `ADVERSARIAL_REVALIDATION.md`.

Both verification passes **report only — they never stage, commit, or rebase** (they run in parallel; git must stay serialized).

**5c. Mutation pass (only if `MUTATION_PLAN.md` says `on`)** — "would the tests catch a defect at all?" Spawn `node-mutation.md` as a **single sub-agent, alone, after 5a and 5b have both returned** — it writes to the source tree, so it cannot overlap with passes that read and test it. It reports survivors; it never fixes. Triage each false green with the operator like a 5b finding.

On return:
- **Conformance (5a):** invalid behaviors → one fix sub-agent for all of them, then re-validate only those. Brief every fix sub-agent: comments describe the code as it is — no ticket IDs, no decision ids, no "now/removed/changed" notes. Under `per-behavior`, that fix sub-agent **folds each fix into the commit owning that behavior** per `nodes/commit-protocol.md` — never a new commit.
- **Adversarial (5b): report + triage.** Present each break/silent-misbehavior with severity; the user decides **new behavior** (→ Phase 4) or **accepted/out-of-scope**. No auto-loop; log each to `DECISIONS.md` (and mirror each to the card). The fix sub-agent applies a fix to an existing behavior and folds it into that behavior's commit under `per-behavior`; a genuinely new behavior goes into the plan first, is mirrored into `PLAN_STEPS.md`, and earns its own commit — either way the one-commit-per-behavior count holds.

Present combined results.

## Phase 6: Summary

Spawn these two in one message:
- `node-summary.md` (reads the state files, aggregates the test/lint status already recorded — no full-project re-run) → complete summary with behaviors, quality gates, conformance + adversarial results, tests, files changed, key decisions. It does not touch the spec.
- `node-spec.md` → writes or updates the feature's living spec from the code.

When the spec writer returns, spawn `node-spec.md` in check mode → it checks every claim in the spec against the code and `DECISIONS.md` and fixes what is wrong. Present the summary and the check result only after the check returns.

## Error Handling

- Sub-agent fails → report and ask how to proceed.
- User skips a phase → mark skipped, proceed.
- Keep `IMPLEMENTATION_PROGRESS.md` current so work survives interruptions.
- Phase context too large → split into more sub-agents.

## Related Skills

`@create-implementation-plan` (Phase 2) · `@bdd-design` (Phase 4) · `@test-quality-reviewer` + `@code-refactoring` (quality gate) · `@context7` + `@web-search` (research).
