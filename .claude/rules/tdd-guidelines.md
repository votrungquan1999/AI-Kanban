---
description: 'TDD guidelines: red-green-refactor cycle, test-first approach, and quality assurance for AI agents'
---

# TDD Guidelines

Test-Driven Development: write tests before implementation using red-green-refactor cycle.

## Core Principles

1. **Red-Green-Refactor** - Write failing test (Red), make it pass (Green), improve code (Refactor)
2. **Test First** - Always write tests before implementation
3. **One Test at a Time** - One test → MUST run test to see it fail → make it pass → next test
4. **Minimum Implementation** - Only code needed to make test pass
5. **Test Quality** - Follow 4 Pillars of Testing (Reliability, Validity, Sensitivity, Resilience)

---

## Red-Green-Refactor Cycle

### Red: Write Failing Test

1. Write ONE test describing desired behavior
2. Use descriptive test names
3. Follow Arrange-Act-Assert structure
4. MUST Run test to verify it fails (not syntax error)

### Green: Make Test Pass

1. Write minimum code to make test pass
2. Don't optimize yet - focus on correctness
3. Run test to verify it passes

### Refactor: Improve Code

1. Ensure all tests pass before refactoring
2. Improve quality (remove duplication, better naming, extract functions)
3. Run tests again to verify nothing broke

**Important:** Only refactor when all tests are passing.

### Repeat

Continue cycle for each test scenario until all implemented and passing.

---

## Test Quality Checklist

**4 Pillars:**

- **Reliability** - Consistent results, no flaky tests, mock external dependencies
- **Validity** - Verify intended behavior, specific assertions, all execute
- **Sensitivity** - Detect defects, specific assertions, test edge cases
- **Resilience** - Survive refactoring, test through public interfaces

**Code Quality:**

- ✅ All tests pass
- ✅ Linting passes
- ✅ Follows conventions

---

## TDD Rules

**Never:**

- ❌ Write multiple tests before implementing
- ❌ Write implementation before tests
- ❌ Consider test passed when the test not actually run

---

## TDD vs BDD — when to use which

- **BDD = outer loop.** User-facing feature behavior, expressed as scenarios with Given/When/Then. This is the default framing for feature development.
- **TDD = inner loop.** Internal logic, algorithms, and utilities driven test-first within a single BDD scenario step.

Both share the same discipline:

- **Test-first GATE** — write and run the test before any implementation (BDD is also test-first; the two never conflict).
- **One at a time** — one scenario (BDD) or one test (TDD), see it fail, make it pass, then move to the next.
