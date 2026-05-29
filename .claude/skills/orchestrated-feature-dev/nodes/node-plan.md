# Node: Plan

Create a focused implementation plan using research output as context.

## Input

Read the `RESEARCH_OUTPUT.md` file from the project root for context about the codebase.

## Execution

1. **Read the research output** to understand patterns, affected areas, and existing code.

2. **Use `@create-implementation-plan`** to create the plan. When the skill asks you to research, point it to the research output file instead of re-reading the codebase — the research is already done.

3. **Ensure the plan has the two key sections:**
   - **Technical Design**: Only significant decisions (new fields, API changes, strategy choices). Skip anything obvious.
   - **Behaviors to Implement**: Observable behaviors as TDD steps — not code tasks:
     - ✅ `User sees trending markets at the top`
     - ✅ `Valid inputs are persisted to the standard settings`
     - ❌ `Add isTrending field to database`
     - ❌ `Add StandardSettings validation schema`

4. **Write the step list** to the workflow state file for the TDD loop to consume.

## Output

After the plan is approved, write the step list to `PLAN_STEPS.md` in the project root:

```markdown
# Planned Steps

## Step 1: [Observable behavior]
- Status: pending
- Affected files: [file1, file2, ...]
- Dependencies: none | [step numbers this depends on]

## Step 2: [Observable behavior]
- Status: pending
- Affected files: [file1, file3, ...]
- Dependencies: none | Step 1

## Step 3: [Observable behavior]
- Status: pending
- Affected files: [file2, file4, ...]
- Dependencies: none | Step 1, Step 2

## Quality Checkpoint (after steps 1-3)
- Status: pending

## Step 4: [Observable behavior]
- Status: pending
- Affected files: [file5, ...]
- Dependencies: none | Step 2

...
```

Each step MUST include:
- **Affected files** — every file that will be created, modified, or read during implementation
- **Dependencies** — which other steps must complete first (or "none")

The implementation plan itself is written to `implementation-plan.md` per the `@create-implementation-plan` skill convention.
