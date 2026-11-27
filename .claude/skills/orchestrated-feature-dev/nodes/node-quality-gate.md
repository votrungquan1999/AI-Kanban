# Node: Quality Gate

Periodic quality check that reviews recent tests and implementation for issues.

> **Task workspace:** State files live in the task working directory `<ws>` (`./tmp/<identifier>/`) given in your prompt.

## Input

Read `<ws>/PLAN_STEPS.md` to identify which behaviors were completed since the last quality check.

If the prompt names a `QUALITY_GATE_<N>_FIXES.md`, run `## Mode: re-check` only and skip Execution — a re-check reviews the recorded fixes, not the whole checkpoint again.

**Depth follows stakes** (each behavior's `Stakes` line in `<ws>/PLAN_STEPS.md`): for `high` behaviors, check every error path and edge case in both the tests and the code; for `medium` and `low`, check the main flow and the points each step below names.

## Execution

### 1. Test Quality Review

Use `@test-quality-reviewer` to review the tests written in the most recent 2-3 behaviors.

Focus on:
- Are tests reliable (no flakiness)?
- Are assertions valid (actually proving correctness)?
- Are tests sensitive (would catch real bugs)? **Answer this by reading the assertion, not by injecting a defect** — see below and step 4.

**No mutation testing in this gate.** Do not edit source to see whether a test goes red, and do not build a mutation harness. That pass exists once, in Phase 5c, budgeted and running alone; doing it per gate re-mutates the same files 3-5 times a run, and one gate that did it spent 62 of its 68 minutes on 96 mutants. Only Phase 5c mutates source; here you read.

### 2. Code Refactoring Review

Use `@code-refactoring` to review the implementation from recent behaviors.

Focus on:
- Any duplication introduced across recent behaviors?
- Naming clarity?
- Unnecessary complexity?

**If `@code-refactoring` reports missing test coverage → skip the refactoring review** rather than blocking. The tests exist from the BDD loop.

### 3. Comment Review

Review the comments the recent behaviors added or changed, tests included. Read each touched file's diff with wide context (e.g. `-U20`) so every comment is judged next to the code it describes; a pre-existing comment in that window is in scope only if the change made it wrong.

1. Read the comment rules in the project's instructions (`CLAUDE.md`, `.claude/rules/`) and the comment defaults in `nodes/node-bdd-step.md` step 6.
2. For each comment, ask: **would a dev who never saw the old code, the diff, the plan or this session understand it?** Then check it against each rule.
3. For every comment that fails, write the fix — the replacement text, or "delete". When a reason is buried in history wording, restate it as a fact about the code as it is rather than dropping it: "the old per-user subqueries re-scanned the table ~5k times" becomes "one join, not a subquery per user — those re-scan the table per row".

Never skip this when step 2 is skipped; the author's own check is the only other one these comments get.

### 4. Behavior Check

For each of the recent 2-3 behaviors, using the diff read in step 3 and each step's `Affected files` in `<ws>/PLAN_STEPS.md` to find its code:

1. Does the code produce the behavior?
2. Would its test still pass if that code were removed? Judge by reading only; never mutate source (a test that cannot fail guarantees nothing).

For the second question, a behavior with no automated test (skill text, `trivial: no test`, final-check or e2e-only) answers "n/a, no test (reason)", not a finding. A test that would pass without the code: rewrite it so it fails without the code, and note it in your report and the FIXES file. Code that does not produce the behavior: `blocked`.

### 5. Apply Fixes

If issues are found:
1. Fix them immediately; comments you write describe the code as it is — no ticket IDs, no decision ids, no "now/removed/changed" notes
2. Run the tests for the files the fixes touched to confirm nothing broke
3. Record each finding (id, `file:line`, what was wrong) and its fix diff in `<ws>/QUALITY_GATE_<N>_FIXES.md` (`N` = the last behavior number this checkpoint covers) — capture the diff before the fold below, which would otherwise erase it from view. Under `Strategy: defer` the working-tree `git diff` also holds the run's uncommitted behavior code, so record only the lines your fix changed. `pass` writes no file.
4. A finding you cannot fix is `blocked`: the code does not produce the behavior, the fix needs a design or product call, or the pushed-commit / rebase-conflict hand-back below. Record it in the file with the reason.
5. **Fold each fix into the behavior that owns it** — read `<ws>/COMMIT_PLAN.md`; if `Strategy: defer`, run no git write commands. Under `per-behavior`, a refactor or test fix touching already-committed behavior code belongs in that behavior's commit, not a new one — follow the fold procedure in `nodes/commit-protocol.md`. A fix spanning several behaviors folds into each owning commit separately. If a fix's owning commit is already pushed, or a rebase conflicts, **stop and hand it back to the orchestrator** rather than forcing it.

## Mode: re-check

Input is only the FIXES file; do no full re-review.

1. For each recorded finding, read its fix diff: is it fixed, and did the fix introduce a new problem in those lines? Judge by reading — no source mutation.
2. Run the tests the fixes touched; a fresh agent has no test context.
3. Repeat the behavior check (step 4) for every behavior whose code a fix touched, locating its files from the fix diff and each step's `Affected files`.
4. Any further fix: run the tests for the files it touched, then append it under `## Re-check <k>` in the same FIXES file and fold it as in step 5 (a pushed owning commit or rebase conflict is `blocked`).

Return `pass | fixed | blocked` as in Output; the orchestrator stops re-checking after 2 and goes to the operator.

## Output

Report the quality gate result:

```markdown
## Quality Gate: After behaviors [X-Y]

### Test Quality
- **Score**: [Excellent / Good / Needs Improvement]
- **Issues Found**: [count]
- **Issues Fixed**: [count]
- **Details**: [brief list]

### Code Quality
- **Refactoring Applied**: [yes/no]
- **Changes Made**: [brief list, or "none needed"]
- **Comments Fixed**: [count + brief list, or "none"]

### Overall
- **Quality**: pass | fixed | blocked (`blocked` wins when both apply)
- **Notes**: [anything the orchestrator needs to know]
```
