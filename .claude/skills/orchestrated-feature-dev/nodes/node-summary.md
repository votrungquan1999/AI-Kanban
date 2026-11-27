# Node: Summary

Generate a final summary of the entire orchestrated workflow execution.

> **Task workspace:** All state files live in the task working directory `<ws>` (`./tmp/<identifier>/`) given in your prompt. Every state-file path below is relative to `<ws>`.

## Input

Read all workflow state files:
- `<ws>/RESEARCH_OUTPUT.md`
- `<ws>/PLAN_STEPS.md`
- `<ws>/IMPLEMENTATION_PROGRESS.md`
- `<ws>/DECISIONS.md` (if present — the decision log)

## Execution

1. **Count completed behaviors** from `<ws>/PLAN_STEPS.md` (all with status `done`), and read the `Final check` result if the plan has one
2. **Gather quality gate results** from all quality checkpoints
3. **List all files changed** across all behaviors
4. **Check the commit invariant** — read `<ws>/COMMIT_PLAN.md`. Under `Strategy: per-behavior`, `git rev-list --count <base>..HEAD` must equal the number of behaviors with status `done`. Report the count either way; if they differ, say so plainly and name the likely cause (a fix committed separately instead of folded, or a behavior that never got committed) rather than quietly reporting success. Under `Strategy: defer`, skip this and note that the changes are uncommitted by design.
5. **Aggregate test/lint status** from what the run already recorded — each behavior ran its own tests test-first and the quality gates re-ran the recent behaviors' tests, so the suite is already green. Do **not** re-run the whole project's test suite or lint the whole project here; it's slow and redundant. Only if a state file flags an unresolved failure, note it (and at most re-run that one behavior's tests).

## Output

Present to the user:

```markdown
# Feature Development Complete

## Summary
[One-paragraph description of what was built]

## Behaviors Completed: [X/Y]
- **Behavior 1: [behavior]** — ✅ done
- **Behavior 2: [behavior]** — ✅ done (already covered)

[If the plan has a Final check: one line with what ran and its result.]

## Commits: [N commits / M behaviors]
[Under `per-behavior`: list each commit subject against its behavior, and state whether the counts match. Under `defer`: "no commits made — changes are in the working tree for you to commit."]

## Quality Gates: [X] checkpoints passed
- Checkpoint 1 (after behaviors 1-3): [pass/fixed N issues]
- Checkpoint 2 (after behaviors 4-6): [pass/fixed N issues]

## Key Decisions
[From `<ws>/DECISIONS.md` — each point where 2+ viable options existed and one was chosen. Omit this section only if the decision log is empty.]
- [choice]: chose [option] over [alternative(s)] — [why]

## Test/Lint Status
- [From per-behavior results + quality gates — e.g. "all behavior tests green; lint clean per last quality gate". Flag any unresolved failure a state file recorded.]

## Files Changed
- [file1]: [brief description]
- [file2]: [brief description]

## Notes
- [Any caveats, follow-ups, or things to watch out for]
```

## Cleanup

After presenting the summary, remind the user that the entire task workspace `<ws>` (`./tmp/<identifier>/`) can be cleaned up once the feature is complete — it contains `RESEARCH_OUTPUT.md`, `PLAN_STEPS.md`, `implementation-plan.md`, `IMPLEMENTATION_PROGRESS.md`, and the per-step investigation/validation files.

`./tmp/` should be in `.gitignore`; delete `<ws>` once the feature is merged.
