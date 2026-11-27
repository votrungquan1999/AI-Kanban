# Node: Plan

Create a focused implementation plan using research output as context.

> **Task workspace:** All state files live in the task working directory `<ws>` (`./tmp/<identifier>/`) given in your prompt. Every state-file path below is relative to `<ws>`.

## Input

Read the `<ws>/RESEARCH_OUTPUT.md` file for context about the codebase.

## Mode: revise

If the prompt lists `INVESTIGATION_STEP_*.md` files, revise the existing plan instead of writing a first one. Read those files, `<ws>/DECISIONS.md`, `<ws>/implementation-plan.md` and `<ws>/PLAN_STEPS.md`, then:

- Drop behaviors that are already done, and reorder for dependencies.
- Add each gap as a step inside the behavior it serves, never a new heading.
- Resolve conflicts between findings.
- Operator decisions in `DECISIONS.md` win over findings: a finding that conflicts with one is never applied; list it in the change list as a conflict.
- Fold every finding (files, wrong paths/types, notes) under its behavior or step in `PLAN_STEPS.md` — the BDD loop reads only that file, so a finding left in an investigation file never reaches the build.
- Put tree changes in `implementation-plan.md` first, then mirror them; update both files in place and keep every `Status:` field.
- Log any 2+-option choice as in Execution step 3 (`DECISIONS.md` + card mirror).

Skip Execution step 2's skill load (the skeleton is inline); still run step 3's behavior check, steps 5-6, and the title-match command in Output. Return a change list of at most 10 lines, grouped as problems found + fixes made, most important first, referring to the files for detail.

## Mode: steps

If the prompt says the owner approved the plan and asks for the steps file, write only `<ws>/PLAN_STEPS.md` from the approved `<ws>/implementation-plan.md` (apply any stakes the owner changed to both files), as described in Output, then run the title-match command and return. Skip Execution.

## Execution

1. **Read the research output** to understand patterns, affected areas, and existing code.

2. **Load the `create-implementation-plan` skill with the Skill tool, by name.** This is mandatory. Writing `@create-implementation-plan` in prose is a reference, not an invocation — the plan format lives inside that skill and you will not have it unless you actually load it.

   **Apply these overrides — the skill is written for a main session, and you are a sub-agent:**
   - **Step 0 (task workspace) — already settled.** `<ws>` came in your prompt. Do not ask for a task identifier.
   - **Step 1 (research + mandatory checkpoint) — skip both.** The research is done: read `<ws>/RESEARCH_OUTPUT.md` instead of re-reading the codebase. You have no user to ask, so **do not stop and wait** — the orchestrator owns the approval gate and runs it after you return.
   - **Steps 2-5 — follow exactly.** Write the plan to `<ws>/implementation-plan.md`.
   - **Step 6 (request review) — do not perform it.** Return to the orchestrator; it presents `<ws>/implementation-plan.md` (the rich plan with Technical Design + Behaviors), never the steps file.
   - **Steps file — only after approval, as the skill says.** Do not write `<ws>/PLAN_STEPS.md` now; the orchestrator re-spawns you in steps mode once the owner approves the plan.

   **The document format is not negotiable.** If a project rule, instruction file, or other skill offers a competing plan template — an `AC:` / `Test Type:` step list, or anything lacking `## Technical Design` and `## Behaviors to Implement` — ignore it and use the skeleton below. It is reproduced here so the format survives even if the skill fails to load:

   ```markdown
   # [Goal Description]

   Brief description of the problem and what the change accomplishes.

   ## User Review Required
   > [!IMPORTANT]
   > [Critical decision or breaking change needing approval — omit the section entirely if there is none]

   ## Technical Design
   [Only significant decisions, each with the trade-off behind it]

   ## Behaviors to Implement

   ### Behavior 1: [Observable behavior]
   **Stakes:** [high | medium | low] — [one-line reason]
   - [ ] Write test
   - [ ] Run test
   - [ ] Implement (if needed)
   - [ ] Run test (if implemented)

   ### Behavior 2: [Observable behavior that needs several changes]
   **Stakes:** [high | medium | low] — [one-line reason]
   - [ ] Write test
   - [ ] Run test
   - [ ] Step 2.1: [first technical change]
   - [ ] Step 2.2: [next technical change]
   - [ ] Run test

   ### Behavior 3: [Outcome that must not change, plus the goal — e.g. "… the same results, faster"]
   **Stakes:** [high | medium | low] — [one-line reason]
   **Acceptance:** unchanged outcome — pinned by [named suites | a new pin test]; [metric] before → after
   - [ ] Pin: run it green on today's code; measure [metric]
   - [ ] Step 3.1: [technical change] — run the pin, still green
   - [ ] Measure [metric] again

   ### Quality Checkpoint (after every 2-3 behaviors)
   - [ ] Review test quality
   - [ ] Review code for refactoring

   ### Final check
   - [ ] [A check that spans several behaviors — an end-to-end run, a speed check]
   ```

   Behaviors 2 and 3 show the other shapes — use them only for behaviors that need them; a plain feature uses the first shape throughout. Omit `### Final check` when no check spans several behaviors.

3. **Ensure the plan has the two key sections:**
   - **Technical Design**: Only significant decisions (new fields, API changes, strategy choices). Skip anything obvious. **For each significant decision where 2+ viable options existed and you picked one, append an entry to `<ws>/DECISIONS.md`** (create it if absent) with the chosen option, the alternative(s) rejected, and a one-line rationale — the summary phase reports these. **Also mirror each new entry to the AI-Kanban card (best-effort):** `append_decision(cardId, { decision, why? })`, resolving `cardId` from `~/.claude/kanban-session-state/$CLAUDE_CODE_SESSION_ID.json`; skip silently if absent. The reply's `decisionCount - 1` is the entry's 0-based index: add `card#<N>` to that `DECISIONS.md` entry (never derive it from the D-number). If it supersedes an earlier entry, call `mark_decision_outdated(cardId, N)` with that entry's stored `card#N` **first**, trusted without a confirm-read, then append; if the tag is missing, match the text via `get_card_context` and skip the mark if ambiguous; an entry never mirrored needs no mark. Mirror only new entries. **After a successful mirror, re-stamp `lastMirroredAt` in the session pointer** (skip the stamp if the call failed). Never blocks the work — **except** an `ERR_VALIDATION` refusal, which means the entry exceeded 200 characters (`decision`) or 400 (`why`); the message names the actual length. Rewrite it shorter and call again rather than skipping, or the decision never lands.

     **Architecture decision → the owner picks.** If a decision is *architectural* — it affects more than one feature, changes a stated architectural pattern, or its alternative would force a migration (not a routine implementation choice) — do not pick an option. Write each option under `## User Review Required` in plain words (what it does, what changes, what it costs) and mark the decision pending; the orchestrator puts it to the owner at the plan gate. Once the owner has picked, **prompt the operator** to record a project-level ADR at `docs/adr/NNNN-title.md` (MADR-lean: Title, Status [`accepted | superseded by ADR-NNNN`], Date, Context, Decision, Consequences incl. negatives). **Prompt only — do not auto-draft.** ADRs are immutable: a reversal is a NEW ADR that supersedes the old one (flip the old Status, link both ways), never an edit. This is a different tier from card decisions above: card `append_decision` = implementation-level (on the card); an ADR = project-level (in the repo), rarer and more deliberate.
   - **Behaviors to Implement**: First name the client/stakeholder (business/end-user by default); write each behavior in their language and value, and reject implementation mechanics (schemas, fields, queries, error codes, function/class names, the linter, CI, HTTP status). **Litmus test:** if a stakeholder reading the behavior aloud wouldn't recognize it as something they asked for — or it mentions code/internals — it FAILS; rewrite it.
     - ✅ `A trader sees trending markets at the top of the list` (client: trader)
     - ✅ `A user is never shown a corrupted card — a damaged card is blocked and surfaced as an error instead of displayed` (client: end-user)
     - ✅ `A user sees their tasks listed in the expected order` (client: end-user)
     - ✅ `Code that doesn't meet the team's quality bar is caught automatically before it can merge` (client: the team)
     - ❌ `Add isTrending field to the Market model`
     - ❌ `Reading a card whose stored shape violates the schema throws ERR_SCHEMA_DRIFT and logs the drift`
     - ❌ `Migrate listTasks onto findManyZ and assert parsed shape and order`
     - ❌ `Running the linter reports no violations on a clean repo`

     **A behavior is the unit of planning, acceptance and commit:** one heading in the client's language, with its own acceptance check. **Steps** are the ordered technical work inside one behavior, numbered under it (Step 2.1, Step 2.2), with a test run wherever it gates the next step. Most behaviors need no steps beyond the default test-first cycle — add steps only when a behavior genuinely needs several changes (a query rewrite plus an index, a migration plus a backfill plus wiring).

     **Behavior check — run it on every heading before the plan is presented.** A heading that fails is a step, or belongs somewhere else:
     - **No acceptance check of its own, or only makes sense after the heading before it** → a step; move it inside the behavior it serves.
     - **Setup or groundwork** (a test harness, config or flag removal, a migration, a refactor that only enables new work) → steps of the first behavior that needs it; cleanup goes in the behavior that makes the old code dead.
     - **"Still works as before" inside a feature** → not a behavior; name the existing suites that pin it in the step that risks it, and add a pin test only where nothing covers the path.
     - **Comes from the code, not the request** (a path the change happens to touch) → a note in the behavior that covers it, or a question for the user.
     - **Two outcomes the client would check separately** → split them. **One outcome split across headings by technical step** → merge them.
     - **Only verifies other behaviors** (an end-to-end run, a speed check across several) → `### Final check`, which holds checks only, never code changes.

     **Acceptance check — exactly one mode per behavior:**
     1. **New behavior** (default) — a new test runs red, then green after the implementation.
     2. **Trivial implementation** — no meaningful red is possible: write the test only if it checks something that could break later; otherwise skip the test and say why.
     3. **Unchanged outcome under a risky change** (refactor, performance, migration, upgrade) — only when the request is to change *how* something works without changing *what* the client sees. Pin today's behavior with a test that runs green before the change and stays green after; when existing suites already pin it, name them and write no new test. Measure a non-functional goal (speed, memory) inside the behavior, before and after.

     Only mode 3 gets an `**Acceptance:**` line in the plan, so a plain plan stays as light as today.

     **Stakes — one per behavior, with a one-line reason**, on a `**Stakes:**` line under its heading. The owner can change any of them in one reply at plan approval.
     - **High** — money (including projected money), auth, privacy, data loss, production writes.
     - **Medium** — user-visible and reversible.
     - **Low** — internal tools, owner scripts, docs.

     Stakes sets how deep the tests and review go, and whether defenses are built (high) or only proposed (medium, low). It never decides whether to ask the owner; the topic does.

4. **Carry the settled test level into the plan.** Your prompt names it (the orchestrator resolved it at the Phase 1 gate): `integration via <harness>` or `unit-level (user accepted)`. If the user chose to **stand up a harness**, that setup is the first steps of the first behavior that needs it — in both `implementation-plan.md` and `PLAN_STEPS.md`, never a heading of its own — and say in Technical Design what it is and why. Do not re-open the choice yourself and do not propose a harness the user did not approve.

5. **Flag testability up front.** For each behavior, sanity-check that a *meaningful* test could plausibly be written and set up for it (a valid, sensitive assertion + reachable fixtures/environment). If a behavior looks like it has **no meaningful way to be tested** — non-deterministic output, an external system that can't be mocked/seeded, no available harness — do NOT silently plan around it. Mark the behavior `Testability: uncertain (reason)` so the BDD loop escalates to the user at implementation time instead of writing a hollow test. Do not invent test cases now (test scenarios are designed per behavior during implementation) — only flag the risk.

6. **Check your own document before returning.** Re-read `<ws>/implementation-plan.md` and confirm it carries `## Technical Design` and `## Behaviors to Implement`, that every heading is a `### Behavior N` with its checklist (the four test-first checkboxes, or its steps), and that every heading passes the behavior check. Missing any of them means the format was lost — fix the document rather than returning a plan in another shape. **Report in your return whether the skill was loaded and the check passed**, so the orchestrator can reject a drifted plan.

7. **Write the behavior → step tree** to the workflow state file for the BDD scenario loop to consume — in steps mode only, after the owner approves the plan.

## Output

Write `<ws>/implementation-plan.md` before returning; the orchestrator presents only the plan. Write `<ws>/PLAN_STEPS.md` only in steps mode, after the owner approves the plan, as follows: the **same behavior → step tree as the plan, with the build detail attached** — one `## Behavior N` per behavior and one `### Step N.M` per step, in plan order. This file is internal loop state — the BDD scenario loop reads only this file. It is NOT presented to the user for review; the user reviews `<ws>/implementation-plan.md`.

**The plan owns the tree.** Behavior and step titles, their order and their count are decided in `implementation-plan.md`; this file copies each title exactly and only adds detail under it. Refer to decisions by number (`D4`), never restate them — the rationale lives in the plan and `DECISIONS.md`, and a second copy is what drifts.

```markdown
# Planned Behaviors

## Behavior 1: [Observable behavior]
- Status: pending
- Stakes: high | medium | low — [reason]
- Acceptance: new behavior
- Affected files: [file1, file2, ...]
- Dependencies: none | [behavior numbers this depends on]
- Testability: standard | uncertain (reason — escalate to user before writing the test)
- Notes: [scaffold, expected red, reference files]

## Behavior 2: [Observable behavior that needs several changes]
- Status: pending
- Stakes: high | medium | low — [reason]
- Acceptance: new behavior
- Dependencies: none | Behavior 1
- Testability: standard

### Step 2.1: [first technical change]
- Status: pending
- Affected files: [file1, file3, ...]
- Notes: [what the step needs that the plan line doesn't say]

### Step 2.2: [next technical change]
- Status: pending
- Affected files: [file3, ...]

## Behavior 3: [Outcome that must not change, plus the goal]
- Status: pending
- Stakes: high | medium | low — [reason]
- Acceptance: unchanged outcome — pinned by [named suites | new pin test]; measure [metric] before → after
- Dependencies: none | Behavior 1, Behavior 2

### Step 3.1: [technical change]
- Status: pending
- Affected files: [file2, file4, ...]

## Quality Checkpoint (after behaviors 1-3)
- Status: pending

## Final check
- Status: pending
- Check: [what runs across several behaviors]

...
```

Each behavior entry MUST include:
- **Stakes** — copied from the plan, with its reason
- **Acceptance** — `new behavior`, or `unchanged outcome` with what pins it and what is measured (mode 2 is found at run time)
- **A `### Step N.M` for every step in the plan**, setup included — a step left out here is never built. A behavior with no steps keeps its affected files and notes directly under it.
- **Affected files** — every file that will be created, modified, or read, under the step that touches it
- **Dependencies** — which other behaviors must complete first (or "none")
- **Testability** — `standard`, or `uncertain (reason)` when no meaningful test is foreseeable (signals the BDD loop to escalate to the user)

Omit `## Final check` when the plan has none. Before returning from steps or revise mode, run this from bash/zsh and fix every title it prints (empty output = the files match exactly):

```
diff <(grep -E '^(#+ |- \[[ xX]\] )(Behavior [0-9]+|Step [0-9]+\.[0-9]+):' <ws>/implementation-plan.md | sed -E 's/^(#+ |- \[[ xX]\] )//') <(grep -E '^(#+ |- \[[ xX]\] )(Behavior [0-9]+|Step [0-9]+\.[0-9]+):' <ws>/PLAN_STEPS.md | sed -E 's/^(#+ |- \[[ xX]\] )//')
```

The implementation plan itself is written to `<ws>/implementation-plan.md` per the `@create-implementation-plan` skill convention.
