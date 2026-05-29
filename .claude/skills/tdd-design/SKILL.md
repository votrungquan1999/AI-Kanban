---
name: tdd-design
description: Guides test-driven development using red-green-refactor cycle with test-first approach. Use when implementing features with TDD, writing tests before code, refactoring with test safety net, fixing bugs with test reproduction, or when user says "use TDD", "test-driven", "write tests first", or "red-green-refactor".
---

# TDD Design

Test-Driven Development: write tests before implementation, one test at a time.

## Core Principles

1. **Test First** - Always write and run tests before implementation
2. **One Test at a Time** - Write one test → run it → implement → run again → next test
3. **Minimum Implementation** - Only write code needed to make the current test pass
4. **Test Quality** - Follow 4 Pillars of Testing (Reliability, Validity, Sensitivity, Resilience)

---

## Test-First Loop

**Follow this loop for EVERY test case. Do NOT batch tests or skip steps.**

### Step 1: Write ONE Test

1. Write exactly ONE test describing desired behavior
2. Use descriptive test names
3. Follow Arrange-Act-Assert structure

### 🚫 Step 2: GATE — Run the Test (Before Implementation)

1. **Check `package.json` scripts** first for an existing test command (e.g., `npm test`, `npm run test:unit`). Use the project's defined command instead of crafting your own.
2. Run the new test BEFORE writing any implementation
3. If it **fails** → proceed to Step 3 (implement)
4. If it **already passes** → behavior is already covered, skip Step 3, go back to Step 1

**This gate is NON-NEGOTIABLE. Writing implementation before running the test = violation.**

### Step 3: Minimum Implementation

1. Write the **minimum** code needed to make this test pass
2. Focus on correctness, not elegance or optimization

### 🚫 Step 4: GATE — Verify

1. Run the test again (using the project's test command from `package.json`)
2. If it **passes** → go back to Step 1 for the next test
3. If it **fails** → go back to Step 3 and fix the implementation

**Do NOT write a second test before completing this gate.**

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

- ❌ Write implementation code before running the test (even "obvious" code)
- ❌ Write a second test before the current cycle completes
- ❌ Skip a test run because you "know" the result
- ❌ Batch multiple tests then implement them all at once

## Related Skills

- `@bdd-design` - Use BDD for behavior-level/acceptance testing alongside TDD for unit-level testing
- `@test-quality-reviewer` - Review test quality using the 4 Pillars framework after writing tests
- `@code-refactoring` - Apply refactoring patterns to improve code quality
