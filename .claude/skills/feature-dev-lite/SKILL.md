---
name: feature-dev-lite
description: Lightweight, single-session feature implementation — incremental planning, behavior-driven tests, and progress tracking for small-to-medium features. Use when building a feature or task solo in one session and you want structure without orchestration overhead ("implement feature", "build this", "develop this functionality"). For large, high-stakes, or multi-phase work needing automated quality gates and parallel sub-agent phases, use orchestrated-feature-dev instead.
---

# Feature Dev Lite

This Skill is the **lightweight tier** for implementing features and tasks incrementally — behavior-driven development and progress tracking, run solo in a single session. For large or high-stakes work with automated quality gates and parallel sub-agent phases, use `@orchestrated-feature-dev` instead.

## Core Principles

1. **Understand Context First** - Read as many relevant files as possible to understand the codebase before planning
2. **Plan by Behavior** - Define behaviors and their acceptance checks, not implementation details; technical steps live inside the behavior they serve
3. **Test During Implementation** - Define test scenarios when implementing each behavior, not during planning
4. **Track Progress** - Write progress to a file for context switching and interruptions
5. **Incremental Progress** - Complete one behavior fully before moving to the next
6. **Test Each Behavior** - Prove each behavior works before building on top of it
7. **One Test at a Time** - Write exactly one test, run it, see a meaningful result, make it pass, then move to the next test. This ensures incremental validation and prevents skipping test coverage.
8. **Meaningful Red** - A red run only counts when a behavior assertion fails. Structural failures (404 route not registered, missing field/import) validate nothing — scaffold structure before running. When no real red is possible, write the test only if it checks something that could break later; otherwise skip it and say why.
9. **Integration Over Unit** - Default to a test that drives the real flow through the entry point a client actually uses, with real collaborators. An isolated unit test with mocked collaborators passes while the wiring is broken (see [Test Level](#test-level-integration-first)).
10. **Every Test Must Be Able To Fail** - Before writing a test, answer what defect it would catch. If the asserted value is already fixed by the test's own mock setup (stub returns `X` → assert `X`), the implementation isn't in the causal path and the test proves nothing — don't write it.
11. **Record Decisions** - When a behavior involves picking one of 2+ viable options, record it on the AI-Kanban card so the "why" outlives the session (best-effort — see Phase 2).

---

## Phase 1: Planning

**Goal:** Break the work into observable behaviors, each with a clear acceptance check.

**Step 0: Establish the Task Workspace**

**Before writing any notes, the plan, or the progress file**, establish where artifacts go:

- **If a caller gave you a working directory** (e.g. the orchestrator passes `<ws>` = `./tmp/<identifier>/`), use it.
- **Otherwise**, derive a **task identifier** — a ticket id from the request or branch (e.g. `JIRA-123`), else a short kebab-case slug from the request — and state it in one line. Then use `<ws>` = `./tmp/<identifier>/` and create that directory.

Throughout this skill, `<ws>` refers to that working directory. Scoping artifacts under `./tmp/<identifier>/` lets multiple tasks run in parallel without their plan/progress files colliding.

The identifier also doubles as the `<slug>` for the feature's living spec (`docs/features/<slug>/spec.md`, written at completion). If a spec already exists for this `<slug>`, skim it first — this run **updates** that same spec rather than starting a new one.

**Before creating `<ws>` or writing anything, check whether it already holds artifacts from unrelated work.** If it does, **STOP and ask the user** how to proceed — never overwrite another task's artifacts.

**Drop the spec-reminder sentinel (best-effort).** Write `{ slug, specPath: "docs/features/<slug>/spec.md" }` to `~/.claude/spec-reminder-state/$CLAUDE_CODE_SESSION_ID.json`. This is what the `spec-reminder` Stop hook reads to nudge you, at session end, to update the living spec before wrapping up. Skip silently if `$CLAUDE_CODE_SESSION_ID` is unset.

**Step 1: Understand the Context**

Before creating your plan, read as many relevant files as possible to understand:

- Existing patterns and conventions in the codebase
- Related features or components that might be affected
- Architecture and structure of the area you'll be modifying
- Types, interfaces, and data models

This context-gathering phase helps you create a more accurate plan and avoid surprises during implementation.

**Survey the project's test patterns — this is not optional.** You cannot choose a test level, and you certainly cannot ask the user to set one up, before you know what the project already has. Look for:

- The **test command** — `package.json` scripts (or `Makefile`, `pyproject.toml`, `justfile`); note whether integration/e2e has its own script
- **Test locations and naming** — `tests/`, `__tests__/`, `*.test.ts` vs `*.integration.test.ts` vs `tests/e2e/`
- **Harness and setup files** — `vitest.config`, `jest.setup`, `conftest.py`, `playwright.config`, testcontainers, `supertest`, `msw`, an in-memory or throwaway test DB
- **Fixtures, factories, and seeds** — how a test gets a user, a record, a logged-in client; how state is reset between tests
- **One real example** — open an existing integration/e2e test in this repo and read it end to end. It is the template you will mirror, and it tells you more than the config does.

Record the verdict in one line so the plan and the tests inherit it: **the harness that exists, the command that runs it, and the file you will mirror** — or `none found`. See [Test Level](#test-level-integration-first) for what to do with each outcome.

**Critical: Requirement Clarification First.** If anything is unclear or ambiguous, ask the user clarifying questions. Do not assume implementation details, architectural decisions, or requirements. You must proactively ask requirement-focused questions instead of assuming details.

**Mandatory Checkpoint Before Step 2:** Report how many files you read and ask the user whether to read more files, ask more questions, or continue. Do not create a plan until the user explicitly says "continue"; otherwise, follow their instructions and ask again.

**Step 2: Create the Plan**

Write the plan to `<ws>/implementation-plan.md`. MUST pause for user review and wait for user to say "implement it" before starting implementation phase.

**One plan format across both tiers.** The shape below is the one `@create-implementation-plan` defines, and that skill is canonical — if the two ever differ, follow it. If a project rule or another skill offers a competing plan template, this shape still wins; two formats in circulation is what makes plans drift.

**What to include:**

- **Technical Design** — only significant decisions (new fields, API contract changes, strategy choices) and the trade-offs behind them
- **Behaviors to Implement** — ordered observable behaviors; each is one heading, one acceptance check and one commit, with its technical steps inside it
- **Stakes** — each behavior gets high, medium or low stakes with a one-line reason (see below)
- Dependencies between behaviors, and any known blockers or risks

**What NOT to include:**

- Specific test scenarios or test code — those are designed per behavior during implementation
- A verification plan — test-first development verifies as you go
- Every file that will be touched, or detail that follows obviously from existing patterns

**Write behaviors in the client's language.** Name the client/stakeholder first (business/end-user by default) and describe the outcome they would recognize — never implementation mechanics (schemas, fields, queries, error codes, function/class names, the linter, CI, HTTP status). Litmus test: if the stakeholder wouldn't recognize it as something they asked for, rewrite it.

> ✅ `A trader sees trending markets at the top of the list` (client: trader)
> ❌ `Add isTrending field to the Market model`

**A behavior is the unit of planning, acceptance and commit:** one heading in the client's language, with its own acceptance check. **Steps** are the ordered technical work inside one behavior, numbered under it (Step 2.1, Step 2.2), with a test run wherever it gates the next step. Most behaviors need no steps beyond the default test-first cycle — add steps only when a behavior genuinely needs several changes (a query rewrite plus an index, a migration plus a backfill plus wiring).

**Behavior check — run it on every heading before the plan is presented.** A heading that fails is a step, or belongs somewhere else:
- **No acceptance check of its own, or only makes sense after the heading before it** → a step; move it inside the behavior it serves.
- **Setup or groundwork** (a test harness, config or flag removal, a migration, a refactor that only enables new work) → steps of the first behavior that needs it; cleanup goes in the behavior that makes the old code dead.
- **"Still works as before" inside a feature** → not a behavior; name the existing suites that pin it in the step that risks it, and add a pin test only where nothing covers the path.
- **Comes from the code, not the request** (a path the change happens to touch) → a note in the behavior that covers it, or a question for the user.
- **Two outcomes the client would check separately** → split them. **One outcome split across headings by technical step** → merge them.
- **Only verifies other behaviors** (an end-to-end run, a speed check across several) → `### Final check`, which holds checks only, never code changes.

**Acceptance check — exactly one mode per behavior:**
1. **New behavior** (default) — a new test runs red, then green after the implementation.
2. **Trivial implementation** — no meaningful red is possible: write the test only if it checks something that could break later; otherwise skip the test and say why.
3. **Unchanged outcome under a risky change** (refactor, performance, migration, upgrade) — only when the request is to change *how* something works without changing *what* the client sees. Pin today's behavior with a test that runs green before the change and stays green after; when existing suites already pin it, name them and write no new test. Measure a non-functional goal (speed, memory) inside the behavior, before and after.

Only mode 3 gets an `**Acceptance:**` line in the plan, so a plain plan stays as light as today.

**Stakes — one per behavior, with a one-line reason.** The owner can change any of them in one reply.
- **High** — money (including projected money), auth, privacy, data loss, production writes.
- **Medium** — user-visible and reversible.
- **Low** — internal tools, owner scripts, docs.

Stakes sets how deep the tests and review go, and whether defenses are built (high) or only proposed (medium, low).

**Example Plan:**

```markdown
# [Goal Description]

Brief description of the problem and what the change accomplishes.

## Technical Design

- **New `score` field on `Market`**: computed at read time from engagement stats, not persisted — avoids write amplification.

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

**Before presenting the plan, re-read every heading against the behavior check above** and fix any that fail. Present it as behaviors with their steps nested under them.

**Create Progress File:**
Create the progress file at `<ws>/IMPLEMENTATION_PROGRESS.md` (the task workspace from Step 0) to track completed behaviors. Add behaviors ONLY as you work on them, not in advance.

```markdown
# Implementation Progress: [Task Name]

### Behavior 1: [Description]

**Status:** ✅ Done
**Acceptance:** new behavior: red → green

**E2E Tests Written (2 tests, all passing ✅):**

1. ✅ Popover open/close behavior
2. ✅ Form inputs render correctly

**Notes:** Created form components, added client-side validation
```

---

## Phase 2: Implement Each Behavior

**Step 0: State the commit strategy — do not ask.**

Commit **one commit per behavior, fixes folded into the owning commit**: commit each behavior as soon as it goes green, and fold every later fix (quality checkpoint, review) back into the commit that owns that behavior. You end with exactly one commit per behavior in the plan. Folding **rewrites history**, so it is only free while the branch is unpushed. State this in one line and proceed; if the owner asks for another approach (e.g. `defer`: never touch git, the owner commits at the end), follow it.

Record it at the top of `<ws>/IMPLEMENTATION_PROGRESS.md` (`Commit strategy: per-behavior | defer`, plus the base SHA from `git rev-parse HEAD` if per-behavior).

**Step 0b: If the test-pattern survey found no integration harness, ask how to test — before any code.**

Skip this entirely when Phase 1 found a usable harness: you already know what to mirror, so just note `Test level: integration via <harness>` and move on. Otherwise put the three options from [Test Level](#test-level-integration-first) to the user now — this is the last moment the answer is free, since retrofitting a harness after ten mocked tests means rewriting them. Record `Test level: integration via <harness> | unit-level (user accepted: <reason>)` next to the commit strategy, and log it as a decision on the card.

**Under `per-behavior`:**

- **Commit when a behavior goes green**, after its tests, lint, and the diff review (step 10 below) pass. Stage **explicit paths only** — never `git add -A`, `-a`, or `.`. One behavior, one commit, subject naming the behavior in the repo's existing convention.
- **Fold later fixes into the owning commit.** A quality-checkpoint refactor or a review fix to already-committed behavior code belongs in that behavior's commit:
  ```
  git commit --fixup <sha>
  GIT_SEQUENCE_EDITOR=true git rebase --autosquash <base>
  ```
  `GIT_SEQUENCE_EDITOR=true` is what keeps the rebase non-interactive. Re-run the affected tests afterwards.
- **After the autosquash, `git diff <pre-fold tip> HEAD` must be empty** — that proves the rewritten commits hold the same tree; a passing test run does not.
- **Resolve the owning commit by subject, not by a remembered SHA** (`git log --format='%H %s' <base>..HEAD`) — every autosquash rewrites the SHAs after it.
- **A fix that adds genuinely new behavior is a new plan behavior**, and earns its own commit. The invariant is one commit per behavior, so adding a behavior adds a commit.
- **Stop and ask** if the owning commit is already pushed (fold + `--force-with-lease`, or an ordinary follow-up commit that breaks the count) or if a rebase conflicts. Never force-push on your own initiative, and never resolve a conflict with `-X ours` / `-X theirs`.

**For each behavior in your plan:**

1. **Add behavior to progress file** - When starting a new behavior, add it with 🔄 In Progress status
2. **Define test scenarios** - NOW figure out what tests are needed for THIS behavior (you can define empty test scenarios first). Default to **one flow-level test** for the behavior, at the level Step 0b settled and mirroring the example file from the survey; add unit tests only for interior cases the flow cannot reach.

**Then, for EACH test scenario, follow this iterative process:**

3. **Write ONE test** - Write exactly 1 test at a time (you can start with an empty test that just has a description). **CRITICAL: NEVER write multiple tests at once.**
4. **Scaffold structure** - Put in place whatever structure the test touches (route, empty handler, field, empty function returning a default) so the run can only fail on the behavior assertion. Scaffolding contains no behavior logic.
5. **Run the test** - **Check `package.json` scripts** first for an existing test command (e.g., `npm test`, `npm run test:unit`). Use the project's defined command. Expect a **meaningful failure** — the behavior assertion fails. A structural error (404, missing field, import error) is NOT a valid red; fix the scaffolding and run again. If no meaningful red is possible (the scaffolding IS the implementation), keep the test only if it checks something that could break later; otherwise delete it and say why.
6. **Implement code** - Write the minimum code needed to make this ONE test pass. If the behavior has steps, do them in order — they are this implementation — and run the test after any step the next one depends on. Comments describe the code as it is: no ticket IDs, no "now/removed/changed" notes.
7. **Run the test again** - Verify the test now passes
8. **Repeat** - If more test scenarios remain, go back to step 3 for the next test. Continue until all test scenarios are written and passing.

**Unchanged-outcome behaviors** (refactor, performance, migration, upgrade) expect no red — do not manufacture one. Run the pin (the named suites, or a new pin test) **green on today's code before any change**, and take the before measurement if the plan names one; a red pin means the pin is wrong, so stop and ask. Then do the steps in order, re-running the pin after each step that could break it, and take the after measurement at the end.

**After all tests are passing:**

9. **Run linting once for this behavior** - Check for code quality issues and fix any problems; do not re-lint after each edit
10. **Review the changes** - Read the **full diff of this behavior** (every file you touched, not just the last edit) before it gets committed:
    - Every hunk is intentional and belongs to this behavior — drop debug leftovers, stray formatting, and edits to files another behavior owns (under `per-behavior` they land in the wrong commit).
    - Comments follow the project's comment rules — read them in the project's instructions (`CLAUDE.md`, `.claude/rules/`), check every comment you added or changed against each one, and rewrite or delete any that break one. They apply on top of the defaults below and win where the two conflict.
    - Comments are concise and skimmable — one line, one idea, WHY not WHAT; delete any that restate the code.
    - A top-of-file/function block that narrates the steps below it is **broken up and distributed** next to the line each piece describes; at most a one-line intro stays at the top.
    - No ticket IDs in code — they belong in the commit message.
    - Re-run the scoped test if anything changed.
11. **Verify** - All tests pass, the behavior's acceptance check is met
12. **Mark behavior as complete** - Update progress file with ✅ Done, its acceptance result, test list, and notes
13. **Move to next behavior** - Only after current behavior is complete. A behavior with several steps is still one commit, made after its last step.

**Record decisions as you go.** Whenever a behavior involved choosing one of 2+ viable options, record it on the AI-Kanban card (best-effort): `append_decision(cardId, { decision, why? })`, resolving `cardId` from `~/.claude/kanban-session-state/$CLAUDE_CODE_SESSION_ID.json`; skip silently if absent (no card tracked this session). If it supersedes an earlier decision, `mark_decision_outdated(cardId, index)` on the older entry **first** (match it by text via `get_card_context`; skip the mark if you can't locate it unambiguously), then append. **After a successful mirror, re-stamp `lastMirroredAt` in the session pointer** (skip the stamp if the call failed). Never block the work on a mirror failure.

`decision` is capped at **200 characters** and `why` at **400**; over that the call is refused with `ERR_VALIDATION` naming the actual length. A refusal is **not** a mirror failure — rewrite it shorter and call again, or the decision is lost. Only transport failures (no card, server unreachable) are skipped silently.

### Test Level: Integration First

**Default to the integration level: drive the real flow through the entry point a client actually uses** — the HTTP route, the CLI command, the exported service function, the rendered component — **with its real collaborators** (real router, real serialization, real DB against the project's test database). Assert the outcome the client observes.

**Why this is the default, not a preference.** A unit test that mocks its collaborators verifies the mock. It stays green while the route is unregistered, the transaction never commits, the serializer drops a field, the permission check is skipped, or the two modules disagree about a shape. Those are the defects that actually reach production, and only a test that crosses the seams can see them. It also pairs with the meaningful-red rule: a flow-level test fails on a behavior assertion, where a mocked test often fails on the mock's own setup.

**Mock only what you cannot run**: third-party network calls, payment providers, email/SMS, clocks and randomness, and anything that costs money. Never mock the module under test's own neighbours just to isolate it.

**A unit test is right when the case is unreachable from the flow** — a branch of a pure function, a parsing edge case, numeric or date arithmetic. Then it is a **supplement**, not a substitute: the behavior still earns one flow-level test, and the unit tests cover the fiddly interior. Use `@tdd-design` for that inner loop.

**When the survey found no usable integration harness — STOP and ask; do not quietly write unit tests.** Report what you looked for and what you found, then let the user choose:

- **Stand up the harness now** — name the concrete setup you would add (e.g. a test database + a `supertest` client, a Playwright runner) and what it costs. It becomes the first steps of the first behavior that needs it, never a heading of its own.
- **Point you at one you missed** — an existing harness, a docker-compose service, a dev command.
- **Accept unit-level for this feature** — explicitly, with the note that the wiring goes unverified.

Ask **once**, at the Phase 2 Step 0b gate, and apply the answer to every behavior. Never invent heavy infrastructure (containers, a browser runner, CI wiring) without that decision.

### When Writing Tests

**IMPORTANT:** Before writing any tests, read the "4 Pillars of Testing" document: `.claude/rules/testing-pillars.md` first, else look in `docs/` or `repo_knowledge/`. Use it to guide your test writing.

Follow the guidelines in the 4 Pillars document when defining test scenarios and writing tests.

**Key BDD Principle:** Always write ONE test at a time, run it, see a meaningful result (real red on a behavior assertion; when no real red is possible, keep the test only if it checks something that could break later), make/keep it passing, then move to the next test. This ensures you're building incrementally and each test is actually validating behavior.

---

## Progress Tracking Format

```markdown
# Implementation Progress: [Task Name]

### Behavior 1: [Description]

**Status:** ✅ Done
**Acceptance:** new behavior: red → green | trivial: green from start, or no test (why) | unchanged outcome: pinned green before and after by [test or suites][; metric before → after]

**Tests Written (2 tests, all passing ✅):**

1. ✅ Test description
2. ✅ Test description

**Notes:** Brief summary of what was accomplished

### Behavior 2: [Description]

**Status:** 🔄 In Progress

**Steps:** (only when the behavior has several)

- ✅ Step 2.1: [technical change] — test run green
- ⏳ Step 2.2: [technical change]

**Tests Written (1 of 3 tests passing ✅):**

1. ✅ Test passing
2. ⏳ Test not written yet
3. ⏳ Test failing

**Notes:** Current work in progress
```

**Status indicators:**

- ✅ Done - Behavior complete, tests passing, acceptance check met
- 🔄 In Progress - Currently working on this behavior

**Test indicators:**

- ✅ Test passing
- ⏳ Test not written yet or failing

**Update frequency:**

- Add behavior to progress file when you start working on it (🔄 In Progress)
- Update tests list as you write them (⏳ → ✅), and its steps as each one lands
- Mark behavior complete when done (🔄 In Progress → ✅ Done)
- Add notes about what was accomplished or issues encountered

**Important:** Don't pre-create behaviors in the progress file. The plan file already has all behaviors defined. Only add a behavior to progress when you actually start working on it.

### What to Avoid During Implementation

- ❌ Skipping the acceptance check for any behavior
- ❌ Moving to the next behavior with failing tests
- ❌ Not updating progress file
- ❌ Writing tests without consulting project testing guidelines
- ❌ Pre-creating behaviors in progress file (only add when working on them)
- ❌ Mocking the code's own collaborators to dodge the real flow — mock only what you cannot run
- ❌ Falling back to unit tests because no harness exists, without asking (Step 0b)
- ❌ Asserting a value your own mock setup already fixed (stub returns `X` → assert `X`) — it passes if you delete the implementation
- ❌ Asserting a collaborator *was called* instead of asserting the outcome the client observes — a call log is wiring, not behavior
- ❌ Adding a test to lift a coverage number rather than to pin a behavior
- ❌ Polishing a screen built only so the owner can verify a feature by hand (loading flashes, rare edge states, cosmetic races) — fix only what stops the check or shows wrong data; list the rest once as known limits

### Quality Checkpoints

**Every 2-3 completed behaviors**, pause to review quality:
- Use `@test-quality-reviewer` on the recent tests — it runs the necessity gate before the 4 Pillars. **Deleting a test it reports as unable to fail is a valid outcome of the checkpoint**, not a regression to argue with.
- Use `@code-refactoring` to identify cleanup opportunities in recent implementation
- Fix any issues before continuing to the next behavior

## Phase 3: Completion

When the feature is done — all behaviors complete, tests and lint green:

- **Run the Final check** if the plan has one — the checks that span several behaviors. Record the result in the progress file; it changes no code.

- **Check the commit invariant.** Under `per-behavior`, `git rev-list --count <base>..HEAD` must equal the number of completed behaviors. Report the count either way; if they differ, say so plainly and name the likely cause (a fix committed separately instead of folded, or a behavior never committed) rather than quietly reporting success. Under `defer`, note that the changes are uncommitted by design.
- **Write/update the living spec.** Write `docs/features/<slug>/spec.md` in the repo you're working on: what the feature does, its behaviors/ACs, and pointers to key files + PRs. `<slug>` is the Step-0 task identifier — reuse it so a later change to the same feature updates the same spec. First search `docs/features/*/` for an existing spec on this feature and **update-in-place** rather than blind-overwriting. No identifier available? Derive a slug from the git branch or ask the operator; if none can be established, **skip the spec write** (don't guess a slug). **Re-read the final diff and make sure the spec reflects the *latest* behavior** — if you updated it early and later work changed behavior, fold that in now. "Present but stale" is a real gap the `spec-reminder` hook can't catch (it only sees whether the file was touched, not whether it's current).
- **Architectural decision → prompt for an ADR.** If a decision made during this work is *project-level architectural* (affects more than one feature, changes an architectural pattern, or its alternative would force a migration — not a routine implementation choice), **prompt the operator** to record a `docs/adr/NNNN-title.md` (MADR-lean: Title, Status [`accepted | superseded by ADR-NNNN`], Date, Context, Decision, Consequences incl. negatives). **Prompt only — don't auto-draft.** ADRs are immutable: a reversal is a NEW ADR that supersedes the old one (flip the old Status, link both ways), never an edit. This is a different tier from card decisions: card `append_decision` = implementation-level (on the card); an ADR = project-level (in the repo).

## Related Skills

- `@bdd-design` - Core BDD scenario methodology used during implementation
- `@tdd-design` - Inner-loop helper for unit/algorithm-level tests within one behavior
- `@test-quality-reviewer` - Review test quality during quality checkpoints
- `@code-refactoring` - Apply refactoring patterns during quality checkpoints
- `@create-implementation-plan` - Canonical owner of the plan format used in Phase 1; invoke it when the design warrants a fuller treatment
- `@orchestrated-feature-dev` - Premium version with automated quality gates and sub-agent phases
