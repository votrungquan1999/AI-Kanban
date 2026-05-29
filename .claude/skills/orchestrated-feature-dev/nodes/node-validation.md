# Node: Validation

Post-implementation validation of a single plan step. Multiple instances run in parallel — one per step — each with full plan and implementation context.

## Input

- Read `implementation-plan.md` for the **full plan**
- Read `PLAN_STEPS.md` for step statuses
- Read `IMPLEMENTATION_PROGRESS.md` for implementation details across all steps
- You are assigned **Step [N]** — validate this step only, but use the full context to check cross-step consistency

## Execution

### 1. Verify Implementation Matches Plan

Read the files changed for your step (listed in `IMPLEMENTATION_PROGRESS.md`):
- Does the implementation actually deliver the planned behavior?
- Are there deviations from the plan that weren't documented?
- Was the technical approach from the plan followed?

### 2. Verify Test Coverage

Find and read the test(s) written for this step:
- Does the test actually assert the planned behavior?
- Run the test in isolation — does it pass?
- Is the test testing the right thing (not just passing by coincidence)?
- Could the test pass even if the implementation were wrong (false positive)?

### 3. Check for Regressions Against Other Steps

- Read the implementation of adjacent steps (those that touch shared files)
- Are there conflicts introduced by this step's changes?
- Did this step accidentally overwrite or break another step's work?

### 4. Run Related Tests

Run tests related to this step's affected area:
- The step's own test(s)
- Tests for features that share the same files
- Report any failures

### 5. Check Code Quality

Quick review of the implementation:
- Does it follow the codebase's existing patterns?
- Any obvious bugs, missing error handling at system boundaries, or type issues?
- Any leftover debug code or TODOs?

## Output

Write findings to `VALIDATION_STEP_[N].md` in the project root:

```markdown
# Validation: Step [N] — [behavior description]

## Implementation vs Plan
- **Matches plan**: yes | partial | no
- **Deviations**: [list, or "none"]

## Test Coverage
- **Test file**: [path]
- **Assertions valid**: yes | no — [details]
- **Test passes**: yes | no
- **False positive risk**: low | medium | high — [why]

## Cross-Step Consistency
- **Shared files checked**: [list]
- **Conflicts with other steps**: [list, or "none"]

## Test Results
- **Step test**: ✅ pass | ❌ fail
- **Related tests**: ✅ all pass | ❌ [failures]

## Issues Found
- [Issue description and severity, or "None"]

## Verdict
- **Step valid**: yes | yes with caveats | no
- **Action needed**: none | [specific fix required]
```
