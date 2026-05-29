# Node: TDD Step

Execute one red-green-refactor cycle for a single observable behavior.

## Input

Read the `PLAN_STEPS.md` file to find the next `pending` step.

## Execution

### 1. Identify the Behavior

Find the first step with `Status: pending` in `PLAN_STEPS.md`. This is your target behavior.

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

**IMPORTANT:** Write exactly **one test** (one `it()` block) per TDD step. Do NOT batch multiple behaviors into the same step. Each step = one observable behavior = one test = one implementation cycle.

### 3. 🚫 GATE: Run the Test

**Before running**, check `package.json` for the project's existing test command (e.g., `npm test`, `npm run test:unit`). Use that command instead of hardcoding `npx vitest run`. Pass the specific test file path to scope the run.

Run the test. You **MUST** see the result before writing ANY implementation code.

- **If it fails** → proceed to step 4
- **If it passes** → behavior is already covered. Update `PLAN_STEPS.md` to mark this step as `done (already covered)`. Skip to Output.

### 4. Implement

Write the **minimum code** to make the test pass. Nothing more.

### 5. Run the Test Again

Confirm it passes. Also run any related previous tests to check for regressions.

- **If all pass** → proceed to Output
- **If regression** → fix the regression, run tests again

### 6. Quick Refactor (Optional)

Only if there's an obvious improvement. Keep it small. Run tests again.

## Output

Update `PLAN_STEPS.md`:
- Change the completed step's status to `done` (or `done (already covered)`)

Update `IMPLEMENTATION_PROGRESS.md` with the step result:

```markdown
### Step [number]: [behavior]

**Status:** ✅ Done
**Test Result:** red → green | already covered

**Files Changed:**
- [file1]: [what changed]
- [file2]: [what changed]

**Regressions:** none | [list]
**Notes:** [anything worth mentioning]
```
