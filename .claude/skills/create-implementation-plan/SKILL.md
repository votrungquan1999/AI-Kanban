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

### Step 0: Establish the Task Workspace

**Before writing any notes or the plan document**, decide where artifacts go:

- **If a caller gave you a working directory** (e.g. the orchestrator passes `<ws>` = `./tmp/<identifier>/`), use it as-is — write the plan there and skip the rest of this step.
- **Otherwise**, derive a **task identifier** — a ticket id from the request or branch (e.g. `JIRA-123`), else a short kebab-case slug from the request — and state it in one line. Then use `<ws>` = `./tmp/<identifier>/` and create that directory.

Throughout this skill, `<ws>` refers to that working directory. Scoping artifacts under `./tmp/<identifier>/` lets multiple planning tasks coexist without overwriting each other.

**Before creating `<ws>` or writing anything, check whether it already holds artifacts from unrelated work** (a different ticket/slug, or a stray flat file). If it does, **STOP and ask the user** how to proceed — never overwrite another task's artifacts.

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
- Architecture choices: write up the alternatives with their trade-offs and let the owner pick; do not pick one yourself
- Once the owner picks, delete the rejected options and keep a one-line Decision Log entry for each.
- Breaking changes (API, config, behavior)
- Areas of uncertainty or risk

For complex designs, consider using the `@structured-brainstorming` workflow to explore alternatives.

**Do NOT list every file that will change or describe every function.** Only capture decisions that a reviewer needs to understand the approach.

### Step 4: Define Observable Behaviors & Test Cases

**Identify the client first.** Before listing any behavior, name the client/stakeholder of the feature. By DEFAULT this is a business or end-user stakeholder. Frame every behavior as an outcome that stakeholder would recognize and care about, in their words — business/end-user language is the default. ONLY when the user explicitly states the client is a developer or an internal/consuming system (e.g. a library/API contract) may you phrase behaviors in developer terms.

List the behaviors the system should exhibit, ordered by implementation priority. **A behavior is the unit of planning, acceptance and commit:** one heading in the client's language, with its own acceptance check. **Steps** are the ordered technical work inside one behavior, numbered under it (Step 2.1, Step 2.2), with a test run wherever it gates the next step. Most behaviors need no steps beyond the default test-first cycle — add steps only when a behavior genuinely needs several changes (a query rewrite plus an index, a migration plus a backfill plus wiring).

**CRITICAL: ONE TEST AT A TIME**
Never batch behaviors or write multiple tests at once. Write one test, then the implementation that makes it pass, before the next test.

Each behavior must be:
- **Observable** — something a user or system can verify externally
- **In the client's language** — describe the outcome the stakeholder sees, never implementation mechanics (schemas, fields, tables, queries, error codes, function/method/class names, the linter, CI, HTTP status, etc.)

**Litmus test:** Read the behavior aloud to the stakeholder. Would they recognize it as something they asked for and care about? If it mentions code or internal mechanics, it FAILS — rewrite before proceeding.

> ✅ `User sees trending markets at the top of the list`
> ✅ `Valid inputs are persisted to the standard settings`
> ✅ `Markets with score below threshold are excluded from trending`
> ✅ `A user is never shown a corrupted card — a damaged card is blocked and surfaced as an error instead of displayed` (client: end-user)
> ✅ `A user sees their tasks listed in the expected order` (client: end-user)
> ✅ `Code that doesn't meet the team's quality bar is caught automatically before it can merge` (client: the team)
> ❌ `Add isTrending field to Market model`
> ❌ `Add StandardSettings interface to types file`
> ❌ `Write SQL query for trending markets`
> ❌ `Reading a card whose stored shape violates the schema throws ERR_SCHEMA_DRIFT and logs the drift`
> ❌ `Migrate listTasks onto findManyZ and assert parsed shape and order`
> ❌ `Running the linter reports no violations on a clean repo`

**Behavior check — run it on every heading before the plan is presented.** A heading that fails is a step, or belongs somewhere else:
- **No acceptance check of its own, or only makes sense after the heading before it** → a step; move it inside the behavior it serves.
- **Setup or groundwork** (a test harness, config or flag removal, a migration, a refactor that only enables new work) → steps of the first behavior that needs it; cleanup goes in the behavior that makes the old code dead.
- **Splitting work into tickets** follows the same rule: each ticket delivers a behavior the client can test; no setup-only ticket (schema, infra, a service on its own).
- **"Still works as before" inside a feature** → not a behavior; name the existing suites that pin it in the step that risks it, and add a pin test only where nothing covers the path.
- **Comes from the code, not the request** (a path the change happens to touch) → a note in the behavior that covers it, or a question for the user.
- **Two outcomes the client would check separately** → split them. **One outcome split across headings by technical step** → merge them.
- **Only verifies other behaviors** (an end-to-end run, a speed check across several) → `### Final check`, which holds checks only, never code changes.

**Acceptance check — exactly one mode per behavior:**
1. **New behavior** (default) — a new test runs red, then green after the implementation.
2. **Trivial implementation** — no meaningful red is possible: write the test only if it checks something that could break later; otherwise skip the test and say why.
3. **Unchanged outcome under a risky change** (refactor, performance, migration, upgrade) — only when the request is to change *how* something works without changing *what* the client sees. Pin today's behavior with a test that runs green before the change and stays green after; when existing suites already pin it, name them and write no new test. Measure a non-functional goal (speed, memory) inside the behavior, before and after.

Only mode 3 gets an `**Acceptance:**` line in the plan, so a plain plan stays as light as today. The shapes are in the Step 5 template; group a quality checkpoint after every 2-3 behaviors.

**Stakes — one per behavior, with a one-line reason.** The owner can change any of them in one reply.
- **High** — money (including projected money), auth, privacy, data loss, production writes.
- **Medium** — user-visible and reversible.
- **Low** — internal tools, owner scripts, docs.

Stakes sets how deep the tests and review go, and whether defenses are built (high) or only proposed (medium, low).

### Step 5: Write the Plan Document

Write the plan to `<ws>/implementation-plan.md` (the task workspace from Step 0) using this format:

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

### Behavior 1: [Observable behavior]
**Stakes:** [high | medium | low] — [one-line reason]
- [ ] Write test
- [ ] Run test
- [ ] Implement (if needed)
- [ ] Run test (if implemented)

### Behavior 2: [Observable behavior that needs several changes]
**Stakes:** [high | medium | low] — [one-line reason]
- [ ] Write test
- [ ] Run test
- [ ] Step 2.1: [first technical change]
- [ ] Step 2.2: [next technical change]
- [ ] Run test

### Behavior 3: [Outcome that must not change, plus the goal — e.g. "… the same results, faster"]
**Stakes:** [high | medium | low] — [one-line reason]
**Acceptance:** unchanged outcome — pinned by [named suites | a new pin test]; [metric] before → after
- [ ] Pin: run it green on today's code; measure [metric]
- [ ] Step 3.1: [technical change] — run the pin, still green
- [ ] Measure [metric] again

### Quality Checkpoint (after every 2-3 behaviors)
- [ ] Review test quality
- [ ] Review code for refactoring

### Final check
- [ ] [A check that spans several behaviors — an end-to-end run, a speed check]
```

Behaviors 2 and 3 show the other shapes — use them only for behaviors that need them; a plain feature uses the first shape throughout. Omit `### Final check` when no check spans several behaviors.

### Step 6: Request Review

**MUST pause for user review.** Present the implementation plan document (`<ws>/implementation-plan.md`) — the rich plan with Technical Design + Behaviors — and wait for approval before any implementation begins.

**NEVER present a steps file for review.** A derived steps file (e.g. `<ws>/PLAN_STEPS.md`) is workflow-state for the BDD scenario loop, not the artifact the user reviews. Write it only AFTER the plan is approved, and do not ask the user to review it.

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
