# Node: Validation

Post-implementation validation of assigned plan behaviors. A few instances run in parallel — each assigned a **batch of related behaviors** (grouped by shared files) — each with the plan and implementation context it needs.

> **Task workspace:** All state files live in the task working directory `<ws>` (`./tmp/<identifier>/`) given in your prompt. Every state-file path below is relative to `<ws>`.

> **Report only — never touch git.** Several instances of you run in parallel, so staging, committing, or rebasing here would race the others and corrupt the branch. Record what needs fixing in your verdict; the single fix sub-agent that follows applies it and folds it into the owning commit.

## Input

- Read `<ws>/implementation-plan.md` and `<ws>/PLAN_STEPS.md`, focusing on the sections relevant to your assigned behaviors — read them ONCE and reuse for all your behaviors
- In `<ws>/IMPLEMENTATION_PROGRESS.md`, read your assigned behaviors' entries plus the entries of behaviors that share the same files (needed for cross-behavior checks) — not the whole file
- You are assigned **one or more behaviors** — validate ONLY those, one at a time. Files shared between your assigned behaviors need to be read only once.

## Execution

**Run this procedure for EACH assigned behavior, one at a time:**

### 1. Verify Implementation Matches Plan

Read the files changed for the behavior (listed in `<ws>/IMPLEMENTATION_PROGRESS.md`):
- Does the implementation actually deliver the planned behavior?
- Are there deviations from the plan that weren't documented?
- Was the technical approach from the plan followed, every planned step included?

### 2. Verify Test Coverage & Meaningfulness

Find and read the test(s) written for this behavior:
- **Each test earns its place** — ask this FIRST, before coverage: what defect would this test catch that no other test catches? If the answer is "none", the verdict is **delete it**, not improve it. A test that guarantees nothing still costs maintenance on every refactor and reports coverage it never earned.
- **No entailed assertions** — reject the signature where the asserted value is already fixed by the test's own arrange block: stub a collaborator to return `X`, call through, assert the result is `X`. The implementation is not in the causal path; the test passes just as well if you replace it with a pass-through.
- **Coverage is good**: are all aspects of the planned behavior exercised — happy path plus the relevant edge/error cases and boundaries? Note any part of the behavior left untested.
- **Tests are meaningful** (apply the 4 Pillars, especially Validity & Sensitivity): does each test assert the **observable outcome** — returned value, persisted state, response body, rendered output — in a way that would FAIL if the behavior were wrong? An assertion that a collaborator *was called*, with or without its arguments, is not an outcome: it re-states the wiring the test set up and survives every defect that leaves the call site intact. Reject hollow/tautological tests, over-mocking that bypasses the code under test, and assertions too loose to catch a real defect.
- Does the test actually assert the planned behavior?
- Run the test in isolation — does it pass?
- Could the test pass even if the implementation were wrong (false positive)? Decide this by reading — **never mutate the source to find out.** You run in parallel with other validators; a mutated file breaks their test runs. Phase 5c proves it empirically.
- **Unchanged-outcome behaviors**: no new test is valid only in this mode and for a behavior recorded `trivial: no test (why)`. Confirm the progress trail shows the pin green before the first change and after the last, that the named suites really exercise the outcome, and that any planned measurement has both numbers. A "no new test" behavior outside these two cases is a finding.
- **Skipped tests**: if the behavior is marked `done (test skipped — no meaningful test possible, user approved)`, confirm the skip was user-approved and record the behavior as implementation-only (untested) in the verdict. Do NOT flag it as a coverage gap to fix unless the original reason no longer holds (a fixture/seam now exists that makes a meaningful test possible).

### 3. Check for Regressions Against Other Behaviors

- Read the implementation of adjacent behaviors (those that touch shared files)
- Are there conflicts introduced by this behavior's changes?
- Did this behavior accidentally overwrite or break another behavior's work?

### 4. Run Related Tests

Run tests related to this behavior's affected area:
- The behavior's own test(s), or its pin
- Tests for features that share the same files
- Report any failures

### 5. Check Code Quality

Quick review of the implementation:
- Does it follow the codebase's existing patterns?
- Any obvious bugs, missing error handling at system boundaries, or type issues?
- Any leftover debug code or TODOs?

## Output

For EACH assigned behavior N, write that behavior's findings to its own `<ws>/VALIDATION_STEP_[N].md` (one file per behavior):

```markdown
# Validation: Behavior [N] — [behavior description]

## Implementation vs Plan
- **Matches plan**: yes | partial | no
- **Deviations**: [list, or "none"]

## Test Coverage & Meaningfulness
- **Test file**: [path, or "none — pinned by existing suites: names", or "none — test skipped (user approved): reason"]
- **Coverage adequate**: yes | partial — [what aspect/edge case is untested]
- **Tests meaningful**: yes | no — [earns its place? asserts an outcome, not an entailed value or a mock interaction?]
- **Assertions valid**: yes | no — [details]
- **Test passes**: yes | no
- **False positive risk**: low | medium | high — [why]

## Cross-Behavior Consistency
- **Shared files checked**: [list]
- **Conflicts with other behaviors**: [list, or "none"]

## Test Results
- **Behavior test or pin**: ✅ pass | ❌ fail
- **Related tests**: ✅ all pass | ❌ [failures]

## Issues Found
- [Issue description and severity, or "None"]

## Verdict
- **Behavior valid**: yes | yes with caveats | no
- **Action needed**: none | [specific fix required]
```
