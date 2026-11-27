---
name: test-quality-reviewer
description: Reviews test code quality — first whether each test earns its place (a test that cannot fail is reported for deletion), then the 4 Pillars framework (Reliability, Validity, Sensitivity, Resilience). Use when reviewing tests, analyzing test quality, hunting tests that guarantee nothing, or when user says "review these tests", "check test quality", or "analyze test coverage".
allowed-tools: Agent, Read, Grep, Glob, Write
---

# Test Quality Reviewer

This Skill reviews test code using the **4 Pillars of Good Tests** framework to ensure tests are reliable, valid, sensitive, and appropriately resilient.

## Execution — delegate to a Sonnet 5 sub-agent

**If you are already a sub-agent, do the review yourself** — skip to the framework below; only the main session delegates.

From the **main session**, act as a thin coordinator — do **not** perform the review below yourself:

1. Resolve **which tests / files to review** from the conversation (the one thing only you can see).
2. Spawn **one** sub-agent — `Agent` tool, `subagent_type: general-purpose`, `model: "sonnet"` (Sonnet 5). Pass it the resolved targets, the workspace `<identifier>`, and the framework below as its instructions. The test files are on disk in the shared working directory.
3. It does all the reading/analysis/writing and returns a short summary + the artifact path. Relay those to the user; keep the test-file reads out of the main context.

The framework and steps below are the **sub-agent's** instructions.

## The 4 Pillars Framework

| Pillar | Core Question | Failure Mode |
|--------|--------------|--------------|
| **Reliability** | "Will this test give consistent results?" | Flaky tests, false failures |
| **Validity** | "Does this test actually prove correctness?" | Tests pass but don't verify the real flow |
| **Sensitivity** | "Will this test fail if there are bugs?" | Tests that pass despite defects |
| **Resilience** | "Will this test survive legitimate refactoring?" | Brittle tests that break on every change |

**Important:** Different test types (unit, integration, E2E) emphasize different pillars. But the pillars only grade a test that deserves to exist — **Step 3 runs the necessity gate first**, and a test that fails it is reported for deletion rather than scored.

---

## Review Process

### Step 1: Identify Test Files

Use tools to find test files:
```bash
# Find test files
Glob: **/*.test.ts
Glob: **/*.test.tsx
Glob: **/*.spec.ts
```

### Step 2: Read and Analyze Tests

For each test file, read and analyze:
```bash
Read: path/to/test-file.test.ts
```

### Step 3: Necessity gate (run this BEFORE the pillars)

For each test, answer one question: **what defect would this test catch that no other test catches?**

If the answer is "none", the finding is **delete this test** — not "improve this test". Report it under `Tests to Delete`, not under a pillar. A test that guarantees nothing is not neutral: it costs maintenance on every refactor, and it reports coverage it never earned, so someone reads the suite as covering that behavior and skips writing the test that would have caught the bug.

**The signature that fails this gate most often — entailment.** The asserted value is already fixed by the test's own arrange block:

```typescript
// The implementation is NOT in the causal path.
// Delete getUser's body, return the mock's value, and this still passes.
vi.mocked(api.fetchUser).mockResolvedValue({ id: "123", name: "Ann" })
const result = await getUser("123")
expect(result).toEqual({ id: "123", name: "Ann" })
```

Ask it concretely: **if I replaced the code under test with a pass-through, would this test go red?** If no, it tests the mock.

### Step 4: Apply 4 Pillars Analysis

For each test that passed the necessity gate, evaluate:

#### ✅ Pillar 1: Reliability (Critical for ALL tests)

**Question:** Will this test give consistent results every time?

**Look for:**
- ❌ Hardcoded timeouts: `setTimeout(2000)`
- ❌ Shared mutable state between tests
- ❌ Dependencies on external systems without mocking
- ❌ Tests that depend on execution order
- ❌ Race conditions in async tests

**Good patterns:**
- ✅ Condition-based waits: `await waitFor(() => expect(element).toBeVisible())`
- ✅ Each test sets up its own state
- ✅ Proper cleanup in afterEach/beforeEach
- ✅ Isolated test data

#### ✅ Pillar 2: Validity (Critical for ALL tests)

**Question:** Does this test actually prove what it claims to test?

**Look for:**
- ❌ Conditional assertions that may be skipped
- ❌ forEach loops that might not run (empty arrays)
- ❌ Generic "truthy" checks: `expect(result).toBeTruthy()`
- ❌ Missing assertions for edge cases

**Good patterns:**
- ✅ All assertions always execute
- ✅ Explicit array length checks before forEach
- ✅ Specific assertions: `expect(result).toEqual({ status: "success", count: 5 })`
- ✅ Edge cases explicitly tested

#### ✅ Pillar 3: Sensitivity

**Question:** Would this test fail if a bug was introduced?

**Judge sensitivity against the observable outcome, and nothing else** — the returned value, the persisted row, the response body, the rendered output. An assertion that a collaborator *was called* is not sensitivity, with or without its arguments: it re-states wiring the test itself set up, and it survives every defect that leaves the call site intact. The one exception: when the call to an outside system is itself the behavior (email, payment provider), assert that call with `toHaveBeenCalledWith`.

**Look for:**
- ❌ Asserting a collaborator was called — `toHaveBeenCalled`, `toHaveBeenCalledWith` — in place of asserting the outcome (allowed only when the call to an outside system is the behavior itself, e.g. email, payment provider)
- ❌ Assertions using implementation constants: `expect(msg).toBe(ERROR_MESSAGES.INVALID)`
- ❌ Overly loose assertions: `expect(result).toBeTruthy()`
- ❌ Over-mocking that bypasses real code

**Good patterns:**
- ✅ Specific assertions with exact values, on what the caller actually observes
- ✅ Static literal values: `expect(msg).toBe("Invalid input provided")`
- ✅ Minimal mocking, testing real integrations

**In an integration test this is disqualifying, not a deduction.** An integration test exists to prove the seams hold — routing, serialization, transaction boundary, permission check. Mock the collaborators those seams run through and the test has no subject left. Report it as an integration test that does not integrate, and send it to `Tests to Delete` or a rewrite.

#### ✅ Pillar 4: Resilience (High for E2E, moderate for unit)

**Question:** Will this test survive legitimate refactoring?

**Look for:**
- ❌ Testing internal state: `component.state.isLoading`
- ❌ Testing private methods
- ❌ Brittle CSS selectors: `container.querySelector("div.css-1abc123 > button")`
- ❌ Testing exact error messages that may change

**Good patterns (E2E/Integration):**
- ✅ Testing user-visible behavior: `getByRole("button")`
- ✅ Semantic selectors: `getByRole("button", { name: "Submit" })`
- ✅ Testing public API, not internals
- ✅ Partial string matches for messages: `.toContain("failed")`

**Acceptable for unit tests:**
- ✅ Lower resilience where the unit under test IS the subject — a pure function's branches, a parser, date/number arithmetic

None of that licenses asserting on a collaborator's call log. "It's a unit test" is not a reason to assert on wiring instead of a result.

---

## Review Output Format

For each test file reviewed, provide:

```markdown
## Test File: [filename]

### Overall Assessment
- **Test Type:** [Unit / Integration / E2E]
- **Total Tests:** [number]
- **Quality Score:** [Excellent / Good / Needs Improvement / Poor]

### Tests to Delete
[Each test that failed the necessity gate: name, line, and the one sentence saying what it fails to catch. Write "none" if every test earns its place. This section comes first because it is the only one whose fix is removal.]

### Pillar Analysis

#### ⚡ Reliability: [Pass / Issues Found]
[List specific issues or confirm good patterns]

#### ✓ Validity: [Pass / Issues Found]
[List specific issues or confirm good patterns]

#### 🎯 Sensitivity: [Pass / Issues Found]
[Judged on observable outcomes only. Name any assertion that checks a call instead of a result.]

#### 🛡️ Resilience: [Pass / Issues Found / Acceptable for Unit Tests]
[List specific issues or confirm good patterns]

### Specific Issues

1. **[Test Name]** (Line X)
   - **Issue:** [Description]
   - **Pillar Violated:** [Which pillar]
   - **Recommendation:** [How to fix]

2. **[Test Name]** (Line Y)
   - **Issue:** [Description]
   - **Pillar Violated:** [Which pillar]
   - **Recommendation:** [How to fix]

### Strengths
- [List what the tests do well]

### Recommendations
1. [Priority fix]
2. [Other improvements]
```

---

## Guidelines by Test Type

### Unit Tests
- **Necessity:** CRITICAL - A unit test whose assertion is entailed by its own mocks catches nothing; report it for deletion
- **Reliability:** CRITICAL - Must be deterministic
- **Validity:** CRITICAL - Must verify correct behavior
- **Sensitivity:** HIGH - Scored on the returned value or the state change, never on a call log
- **Resilience:** MODERATE - May pin a pure function's internals; never a collaborator's calls

### Integration Tests
- **Necessity:** CRITICAL - If its own collaborators are mocked it is not an integration test, whatever it is named; report it for deletion or rewrite
- **Reliability:** CRITICAL - Must be deterministic
- **Validity:** CRITICAL - Must verify correct integration
- **Sensitivity:** HIGH - Scored ONLY on the outcome that crossed the seam (response body, persisted row, rendered output). Mock-interaction assertions score zero here
- **Resilience:** HIGH - Focus on interface contracts, not internals

### E2E Tests
- **Necessity:** CRITICAL - Must cover a flow no cheaper test covers; E2E is the most expensive place to test nothing
- **Reliability:** CRITICAL - Must be deterministic
- **Validity:** CRITICAL - Must verify real user flows
- **Sensitivity:** MODERATE - Catch major user-facing bugs, judged on what the user sees
- **Resilience:** CRITICAL - Test user behavior, never implementation

---

## Common Anti-Patterns to Flag

### ❌ Reliability Issues
```typescript
// BAD: Hardcoded timeout
await new Promise(resolve => setTimeout(resolve, 2000))

// BAD: Shared state
let counter = 0
it("test 1", () => { counter++ })
it("test 2", () => { expect(counter).toBe(0) }) // Will fail!
```

### ❌ Validity Issues
```typescript
// BAD: Conditional assertion (might not run)
if ("error" in result) {
  expect(result.error.message).toBe("Failed")
}

// BAD: forEach that might not run
items.forEach(item => {
  expect(item.valid).toBe(true)
})
```

### ❌ Sensitivity Issues
```typescript
// BAD: entailed by its own setup — passes if getUser() becomes a pass-through
vi.mocked(api.fetchUser).mockResolvedValue({ id: "123", name: "Ann" })
expect(await getUser("123")).toEqual({ id: "123", name: "Ann" })

// BAD: asserts the wiring, not the outcome
expect(apiCall).toHaveBeenCalledWith({ id: "123" })

// BAD: Using implementation constants
expect(result.message).toBe(ERROR_MESSAGES.INVALID)

// BAD: Too loose
expect(result).toBeTruthy()
```

### ❌ Resilience Issues (E2E/Integration)
```typescript
// BAD: Testing internal state
expect(component.state.loading).toBe(false)

// BAD: Brittle selector
container.querySelector(".css-xyz123 button")

// BAD: Exact error message
expect(error).toBe("Error at line 42: Connection failed")
```

---

## When to Use This Skill

**Trigger phrases:**
- "Review these tests"
- "Check test quality"
- "Analyze test coverage"
- "Are my tests good?"
- "How can I improve these tests?"
- "Check for flaky tests"

**Use when:**
- After writing new tests
- During code review
- Debugging flaky tests
- Refactoring test suites
- Auditing test quality

**Output:**
- Detailed analysis using 4 Pillars
- Specific issues with line numbers
- Concrete recommendations
- Priority ranking of fixes

---

## Summary

This Skill uses the 4 Pillars framework to systematically review test quality:

1. **Find test files** using Glob
2. **Read tests** using Read
3. **Run the necessity gate** — report tests that cannot fail for deletion
4. **Analyze each pillar** based on test type
5. **Provide specific feedback** with line numbers
6. **Recommend improvements** with priority

**Remember:** The necessity gate runs first — a test that cannot fail is reported for deletion, never scored and never "improved". Past that gate, different test types have different pillar priorities: unit tests can have lower resilience (pinning a pure function's internals), while E2E tests must have high resilience (testing behavior).

## Output

Write your complete findings to `./tmp/<identifier>/test-quality-review.md` — where `<identifier>` is the caller-provided workspace, or a short ticket-id/slug you derive for this task (create the folder if needed). **If it already holds artifacts from unrelated work, STOP and ask the user rather than overwriting.** Do this before finishing, so the caller and user can review the full results.
