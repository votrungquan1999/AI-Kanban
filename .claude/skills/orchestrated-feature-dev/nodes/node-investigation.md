# Node: Investigation

Deep-dive investigation of assigned plan behaviors. A few instances run in parallel — each assigned a **batch of related behaviors** (grouped by shared files/module) — each with full plan context.

> **Task workspace:** All state files live in the task working directory `<ws>` (`./tmp/<identifier>/`) given in your prompt. Every state-file path below is relative to `<ws>`.

## Input

- Read `<ws>/implementation-plan.md` for the **full plan** (all behaviors, technical design, architecture decisions) — read it ONCE and reuse it for all your assigned behaviors
- Read `<ws>/PLAN_STEPS.md` for the behavior list
- You are assigned **one or more behaviors** — investigate ONLY those, one at a time, but use the full plan to understand how each relates to other behaviors. Files shared between your assigned behaviors need to be read only once.

## Execution

**Run this procedure for EACH assigned behavior, one at a time:**

### 1. Understand Your Behavior in Context

Read the behavior's description and its steps, if it has any. Then use the full plan to understand:
- What other behaviors depend on this one
- What this behavior depends on
- How this behavior fits into the overall feature

### 2. Investigate Affected Files

Identify every file this behavior will touch or create:
- Search the codebase for existing files in the affected area
- Read each affected file thoroughly — understand current state, not just surface-level structure
- Check imports, exports, and downstream consumers of affected files
- Note any files that other plan behaviors also touch (shared mutation points)

### 3. Check if Already Implemented

Search for existing code that already satisfies this behavior:
- Grep for related function names, types, constants
- Check if tests already cover this behavior
- Look for partial implementations that might conflict

### 4. Check for Conflicts and Mismatches

Compare what the plan says against what the codebase actually has:
- Does the plan assume a type/interface that doesn't exist or has a different shape?
- Does the plan reference files or functions by wrong names?
- Are there naming conventions the plan violates?
- Does this behavior's approach conflict with another behavior's approach?
- Are there race conditions or ordering issues between behaviors or between the steps inside one?

### 5. Verify Dependencies

- Are the libraries/packages the plan relies on actually installed?
- Are the utilities/helpers the plan references actually available?
- If this behavior depends on another behavior's output, is that output format correct?

### 6. Identify Edge Cases and Risks

- What happens with empty/null/undefined inputs?
- Are there error paths the plan doesn't account for?
- Performance implications for the approach described?
- Security concerns?

## Output

For EACH assigned behavior N, write that behavior's findings to its own `<ws>/INVESTIGATION_STEP_[N].md` (one file per behavior — the orchestrator folds each finding under its behavior or `Step N.M` in `PLAN_STEPS.md`, so tie every finding to the step it belongs to):

```markdown
# Investigation: Behavior [N] — [behavior description]

## Affected Files
| File | Step | Current State | Planned Change | Also Touched By |
|------|------|--------------|----------------|-----------------|
| [path] | [N.M, or "—" for a behavior with no steps] | [what it does now] | [what the plan says to do] | [other behavior numbers, or "none"] |

## Already Implemented
- [ ] Not implemented
- [ ] Partially implemented: [details]
- [ ] Fully implemented: [details]

## Conflicts Found
- [Conflict description, or "None found"]

## Plan Mismatches
- [Mismatch between plan and actual codebase, or "None found"]

## Missing Dependencies
- [Missing dep, or "All dependencies available"]

## Edge Cases / Risks
- [Edge case or risk, or "None identified"]

## Suggested Plan Fixes
- [Specific fix to the plan, with reasoning — a missing change is a new `Step N.M` inside this behavior, not a new heading]

## Verdict
- **Can proceed as planned**: yes | yes with fixes | needs rework
- **Blocking issues**: [list, or "none"]
```
