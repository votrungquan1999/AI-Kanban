---
name: create-implementation-plan
description: Creates a focused implementation plan with technical design decisions and behavior-based test scenarios before execution. Use when planning features, designing changes, creating technical specs, or when user says "create a plan", "plan this feature", "design the approach", or "implementation plan".
allowed-tools: Read, Grep, Glob, Bash, Write, Agent
---

# Create Implementation Plan

Structured approach to creating a focused implementation plan before execution. The plan captures **what matters most**: significant design decisions and the observable behaviors to test — nothing else.

## Purpose

Ensures significant changes are well-thought-out and reviewed before implementation begins. Prevents wasted effort from poor planning.

## When to Use This Skill

- Implementing a new feature or significant change
- Planning a refactor or architectural update
- Working on changes that span multiple files or components
- Need to communicate your approach to stakeholders

## Instructions

### Step 1: Research the Codebase

**Goal:** Understand the existing implementation before planning.

Read as many relevant files as possible to understand:
- Existing patterns and conventions in the codebase
- Related features or components that might be affected
- Architecture and structure of the area you'll be modifying
- Testing patterns and utilities already in place
- Types, interfaces, and data models

**Critical: Requirement Clarification First.** If anything is unclear or ambiguous, ask the user clarifying questions. Do not assume implementation details, architectural decisions, or requirements.

When researching external libraries or APIs, use `@context7` for documentation queries and `@web-search` for broader research.

**Mandatory Checkpoint:** Report how many files you read and ask the user whether to:
- Read more files
- Ask more questions
- Continue to planning

**CRITICAL: You MUST stop execution here and wait.** Do not proceed to Step 2 or start writing the plan until the user explicitly says "continue with implementation plan" or "continue". Answer any user questions during this pause.

### Step 2: Analyze Requirements

- Clarify the goal and success criteria
- Identify edge cases and constraints
- Determine scope boundaries (what's in/out of scope)
- List assumptions and unknowns
- Identify dependencies (external APIs, libraries, other features)

### Step 3: Design the Approach

Focus only on **significant** design decisions — things that are non-obvious, introduce new concepts, or require deliberate choices. Skip general implementation details that follow naturally from existing patterns.

Document:
- Key architectural decisions and why (e.g., new data models, significant new fields, API contract changes, strategy choices)
- Trade-offs considered for non-trivial decisions
- Breaking changes (API, config, behavior)
- Areas of uncertainty or risk

For complex designs, consider using the `@structured-brainstorming` workflow to explore alternatives.

**Do NOT list every file that will change or describe every function.** Only capture decisions that a reviewer needs to understand the approach.

### Step 4: Define Observable Behaviors & Test Cases

List the behaviors the system should exhibit, ordered by implementation priority. Each behavior becomes one TDD step — a strictly isolated test-first cycle.

**CRITICAL: ONE TEST AT A TIME**
Never batch behaviors or write multiple tests at once. Each step must be exactly one behavior, which translates to exactly one test, followed immediately by its implementation.

Each behavior must be:
- **Observable** — something a user or system can verify externally
- **Not a code task** — describe what the system does, not how

> ✅ `User sees trending markets at the top of the list`
> ✅ `Valid inputs are persisted to the standard settings`
> ✅ `Markets with score below threshold are excluded from trending`
> ❌ `Add isTrending field to Market model`
> ❌ `Add StandardSettings interface to types file`
> ❌ `Write SQL query for trending markets`

For each behavior, plan the test-first cycle:
```markdown
### [Observable behavior]
- [ ] Write test
- [ ] Run test
- [ ] Implement (if needed)
- [ ] Run test (if implemented)
```

Group quality checkpoints after every 2-3 behaviors:
```markdown
### Quality Checkpoint
- [ ] Review test quality
- [ ] Review code for refactoring
```

### Step 5: Write the Plan Document

Write the plan to a file in the project (e.g., `implementation-plan.md`) using this format:

```markdown
# [Goal Description]

Brief description of the problem and what the change accomplishes.

## User Review Required

> [!IMPORTANT]
> [Critical decision or breaking change that needs approval]

## Technical Design

[Only significant decisions. e.g.:]
- **New `score` field on `Market`**: Stored as float, computed at read time from engagement stats. Not persisted — avoids write amplification.
- **Trending threshold**: Configured via env var `TRENDING_MIN_SCORE` (default: 0.7) rather than hardcoded, to allow tuning without deploy.

## Behaviors to Implement

### Step 1: [Observable behavior]
- [ ] Write test
- [ ] Run test
- [ ] Implement (if needed)
- [ ] Run test (if implemented)

### Quality Checkpoint (after every 2-3 steps)
- [ ] Review test quality
- [ ] Review code for refactoring
```

### Step 6: Request Review

**MUST pause for user review.** Present the plan and wait for approval before any implementation begins.

---

## Best Practices

- ✅ Capture decisions that require deliberate thought or trade-offs
- ✅ Write behaviors as observable outcomes, not code tasks
- ✅ Highlight breaking changes and decisions needing user input
- ❌ Don't list every file that will be touched
- ❌ Don't describe implementation details that follow obviously from existing patterns
- ❌ Don't add a verification plan — test-first development verifies as you go
- ❌ Don't skip the research phase

## Related Skills

- `@structured-brainstorming` - Use for complex design decisions during Step 3
