---
name: bdd-design
description: Guides Behavior-Driven Development using behavior scenarios with a test-first approach. Use when implementing features with BDD, writing acceptance tests, defining user behavior scenarios, or when user says "use BDD", "behavior-driven", "write scenarios first", or "acceptance tests".
---

# BDD Design

Behavior-Driven Development: define behavior through scenarios first, then implement to make them pass.

## Core Principles

1. **Scenarios First** - Write behavior scenarios before any implementation
2. **One Scenario at a Time** - Write one scenario → run to see result → implement → verify → next
3. **User Behavior Focus** - Scenarios describe what the user/system does, not how it's coded
4. **Living Documentation** - Scenarios serve as both tests and documentation
5. **Ubiquitous Language** - Use domain language that stakeholders understand

---

## Phase 1: Define Feature and Scenarios

### Step 1: Describe the Feature

Write a feature description that captures the business value:

- **Feature**: [Feature Name]
- **As a**: [role/persona]
- **I want**: [capability]
- **So that**: [business value]

### Step 2: Write Scenarios

Write scenarios describing behavior using three stages:

- **Scenario**: [Descriptive scenario name]
  - **Setup**: [initial context/preconditions]
  - **Action**: [what the user/system does]
  - **Assert**: [expected outcome]

**Guidelines for good scenarios:**
- Each scenario tests ONE specific behavior
- Scenario names should be descriptive and readable
- Use concrete examples, not abstract descriptions
- Cover happy path first, then edge cases and error cases

### Step 3: Review Scenarios Before Implementation

**MUST pause and verify scenarios are complete:**
- Happy path covered?
- Key edge cases identified?
- Error/failure scenarios included?
- Scenarios use domain language, not implementation language?

---

## Phase 2: Implement Scenarios (Test-First)

**For EACH scenario, follow this loop. Do NOT batch scenarios or skip steps.**

**CRITICAL: ONE TEST AT A TIME**
Never batch behaviors or write multiple tests at once. Each step must be exactly one behavior, which translates to exactly one test, followed immediately by its implementation.

### Step 1: Write ONE Scenario Test

1. Write the test for ONE scenario
2. Use the Setup/Action/Assert (Given/When/Then) structure in your test:
   ```typescript
   describe("[Feature name]", () => {
     it("should [expected behavior]", async () => {
       // Setup
       const context = setupContext();

       // Action
       const result = performAction(context);

       // Assert
       expect(result).toEqual(expectedOutcome);
     });

     it("should [another behavior] when [condition]", async () => {
       // Setup / Action / Assert
     });

     // Use nested describe only to group tests under a shared condition:
     describe("when [specific condition]", () => {
       it("should [outcome A]", ...);
       it("should [outcome B]", ...);
     });
   });
   ```

**`describe` is for grouping related tests — not for labeling a single test.** Never wrap a single `it()` in its own `describe` just to add a prefix.

### 🚫 Step 2: GATE — Run the Test (Before Implementation)

1. **Check `package.json` scripts** first to see if there's an existing command for running tests (e.g., `npm test`, `npm run test:unit`). Use the project's defined command instead of crafting your own.
2. Run the new scenario test BEFORE writing any implementation
3. If it **fails** → proceed to Step 3 (implement)
4. If it **already passes** → behavior is already covered, skip Step 3, go back to Step 1

**This gate is NON-NEGOTIABLE. Writing implementation before running the test = violation.**

### Step 3: Minimum Implementation

1. Write the **minimum** code needed to make this ONE scenario pass
2. Focus on correctness, not elegance

### 🚫 Step 4: GATE — Verify

1. Run the test again
2. If it **passes** → also run all previous scenario tests, then go back to Step 1
3. If it **fails** → go back to Step 3 and fix the implementation

**Do NOT write a second test before completing this gate.**

---

## Phase 3: Verify Complete Behavior

After all scenarios pass:

1. Run the full test suite
2. Review scenarios as living documentation — do they clearly describe the feature?
3. Run linting
4. Verify all acceptance criteria are covered by scenarios

---

## Scenario Patterns

### Happy Path
- **Scenario**: User successfully creates an account
  - **Setup**: User is on the registration page
  - **Action**: Fill in valid registration details and submit
  - **Assert**: Account is created, user is redirected to dashboard

### Edge Case
- **Scenario**: User tries to register with existing email
  - **Setup**: A user with email "test@example.com" already exists
  - **Action**: Try to register with email "test@example.com"
  - **Assert**: Error "Email already registered" shown, no new account created

### Error Handling
- **Scenario**: User submits form with missing required fields
  - **Setup**: User is on the registration page
  - **Action**: Submit the form without filling in the email
  - **Assert**: Validation error shown for email field, form is not submitted

---

## Best Practices

- ✅ Write scenarios in domain language, not code language
- ✅ One scenario = one behavior = one `it()` block
- ✅ Use `describe` to group related tests, not to label a single test
- ✅ Run the test after writing it, BEFORE writing implementation
- ✅ Keep scenarios independent — no test ordering dependencies
- ✅ Use descriptive `it()` names that read like sentences
- ❌ Don't wrap a single `it()` in its own `describe` just to add a label prefix
- ❌ Don't write implementation-specific scenarios ("When the database query returns...")
- ❌ Don't write multiple scenarios before implementing any
- ❌ Don't skip the test run — always run the test before implementing
- ❌ Don't write implementation code before seeing the test result

---

## BDD vs TDD: When to Use Which

| Aspect | BDD | TDD |
|--------|-----|-----|
| **Focus** | User behavior & acceptance criteria | Code units & implementation |
| **Language** | Domain/business language | Technical/code language |
| **Scope** | Feature-level, integration, E2E | Function-level, unit |
| **Best for** | User-facing features, API contracts | Algorithms, utilities, business logic |

**Use BDD when:** Implementing user stories, defining API behavior, writing acceptance tests.
**Use TDD when:** Implementing internal logic, algorithms, utilities, data transformations.
**Use both together:** BDD for outer loop (feature behavior), TDD for inner loop (implementation details).

## Related Skills

- `@tdd-design` - Use for inner-loop unit-level testing alongside BDD
- `@test-quality-reviewer` - Review BDD test quality using the 4 Pillars framework
- `@code-refactoring` - Refactor implementation code after scenarios pass
