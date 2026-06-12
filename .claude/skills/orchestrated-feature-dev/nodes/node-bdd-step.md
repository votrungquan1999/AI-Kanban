# Node: BDD Scenario Step

Execute one BDD scenario (test-first) for a single observable behavior.

> **Task workspace:** All state files live in the task working directory `<ws>` (`./tmp/<identifier>/`) given in your prompt. Every state-file path below is relative to `<ws>`.

## Input

Read the `<ws>/PLAN_STEPS.md` file to find the next `pending` step.

## Execution

### 1. Identify the Behavior

Find the first step with `Status: pending` in `<ws>/PLAN_STEPS.md`. This is your target behavior.

### 2. Write the Test

Use BDD-style Given/When/Then structure:

```typescript
describe('[Feature/Scenario name]', () => {
  it('should [expected outcome]', async () => {
    // Given
    // When
    // Then
  })

  // Use nested describe only to group multiple related tests:
  // describe("when [specific condition]", () => {
  //   it("should [outcome A]", ...);
  //   it("should [outcome B]", ...);
  // });
})
```

### 2b. One Test Per Step

**IMPORTANT:** Write exactly **one test** (one `it()` block) per BDD scenario step. Do NOT batch multiple behaviors into the same step. Each step = one observable behavior = one test = one implementation cycle.

### 2c. Scaffold Structure

Put in place whatever structure the test touches — register the route, add the field, create the empty handler returning a default — so the test run can only fail on the behavior assertion. Scaffolding contains **no behavior logic**.

**If no meaningful red is possible** (the minimal scaffolding to avoid a structural failure already IS the implementation — e.g., a trivial pass-through or a field that just renders), write just enough code to pass first and expect **green from the first run**. Record `green from start (no meaningful red possible)` in the Output.

### 3. 🚫 GATE: Run the Test

**Before running**, check `package.json` for the project's existing test command (e.g., `npm test`, `npm run test:unit`). Use that command instead of hardcoding `npx vitest run`. Pass the specific test file path to scope the run.

Run the test. You **MUST** see the result before writing ANY behavior logic.

- **If it fails on the behavior assertion** → real red, proceed to step 4
- **If it fails structurally** (404 route not registered, missing field, import error) → that red validates nothing; fix the scaffolding (step 2c) and run again
- **If it passes** → either the behavior is already covered, or this is the expected green-from-start case. Update `<ws>/PLAN_STEPS.md` accordingly. Skip to Output.

### 4. Implement

Write the **minimum code** to make the test pass. Nothing more.

### 5. Run the Test Again

Confirm it passes. Also run any related previous tests to check for regressions.

- **If all pass** → proceed to Output
- **If regression** → fix the regression, run tests again

### 6. Quick Refactor (Optional)

Only if there's an obvious improvement. Keep it small. Run tests again.

## Output

Update `<ws>/PLAN_STEPS.md`:
- Change the completed step's status to `done` (or `done (already covered)`)

Update `<ws>/IMPLEMENTATION_PROGRESS.md` with the step result:

```markdown
### Step [number]: [behavior]

**Status:** ✅ Done
**Test Result:** red → green | green from start (no meaningful red possible) | already covered

**Files Changed:**
- [file1]: [what changed]
- [file2]: [what changed]

**Regressions:** none | [list]
**Notes:** [anything worth mentioning]
```
