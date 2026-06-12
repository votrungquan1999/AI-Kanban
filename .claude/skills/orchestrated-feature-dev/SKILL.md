---
name: orchestrated-feature-dev
description: Orchestrated feature development with sub-agent phases, quality gate loops, and structured pipeline. Use when asked for "orchestrated development", "structured feature build", "deep feature workflow", or "full development pipeline".
---

# Orchestrated Feature Development

A structured workflow that orchestrates specialized node phases through a pipeline with quality gate loops. **Parallel and isolation-critical phases** (research, investigation, validation, quality-gate) run as sub-agents with isolated context. **The sequential implementation loop (BDD scenario steps) runs in the main session** to avoid wasting tokens re-reading the same files on every step.

## How This Works

This skill acts as an **orchestrator** — it spawns sub-agents for the phases that benefit from isolation or parallelism, runs the BDD scenario loop inline (since each step shares heavy context with the previous one), and passes data between phases via task-scoped files in a per-task working directory (see **Phase 0** and **Task Workspace & State Files**).

```
[research] → [plan] → [investigation (parallel)] → [bdd-step] ↔ [quality-gate] → [validation (parallel)] → [summary]
                              ↑                         ↑              |
                              fix plan if needed         └── loop back ──┘
```

## Orchestrator Rules

The main session:
- **Spawns sub-agents** for research, planning, investigation (parallel), quality-gate, and validation (parallel) — these benefit from isolated context or parallelism
- **Batches per-step phases** — for investigation and validation, group **2-4 related steps** (by shared files/module) per sub-agent instead of one sub-agent per step. The sub-agent count scales naturally with plan size — do NOT cram more steps into one agent to keep the count down; too many steps per agent congests its context. Per-step agents waste tokens (each re-reads the same plan and shared files); batching pays that cost once per batch.
- **Runs the BDD scenario step loop inline** — each step shares heavy context (same plan, same files, same patterns) with the previous one, so isolating each step wastes tokens on re-reading. The investigation phase already produced curated per-step context in `<ws>/INVESTIGATION_STEP_[N].md`.
- **Reads state files** to make routing decisions and to drive the BDD scenario loop
- **Presents sub-agent outputs** to the user by reading and relaying their output files
- **Fixes state files** when investigation reveals plan issues (update `<ws>/PLAN_STEPS.md` and `<ws>/implementation-plan.md`)

The main session MUST NOT:
- Perform research, planning, investigation, validation, or quality review itself — always delegate to sub-agents for those
- Analyze or summarize research findings in its own words
- Make independent judgment calls about code quality — delegate to the quality-gate sub-agent

## Sub-Agent Architecture

Each phase runs as a sub-agent spawned via the `Agent` tool. This provides:
- **Isolated context** — each phase gets a clean context window, preventing bloat
- **Focused execution** — sub-agents only see their node instructions and relevant state files
- **Clean summaries** — only the results are returned to the orchestrator

**How to spawn a phase sub-agent:**

Use the `Agent` tool with the following pattern:
```
Agent(
  description: "[phase name] - [brief]",
  prompt: "Read the instructions in [path to node file] and execute them.
    [Additional context: user request, relevant state files to read, etc.]
    When done, report: [what the orchestrator needs to know]"
)
```

The sub-agent will execute the node instructions and return a summary. The orchestrator then reads the state files and makes routing decisions.

**Model selection (cost lever):** the Agent tool accepts a per-call `model` parameter (`"haiku" | "sonnet" | "opus"`). Investigation and validation are mostly mechanical read-and-report work — spawn those sub-agents with a smaller model (e.g. `model: "sonnet"`, or `"haiku"` for the summary phase). Keep research, planning, and quality-gate on the session's default model (omit `model`) — they need full judgment. A `CLAUDE_CODE_SUBAGENT_MODEL` env var, if set, overrides all of this.

## Task Workspace & State Files

Every run is scoped to a **task identifier** — a ticket id (e.g. `JIRA-123`, `LINEAR-456`) or a short confirmed kebab-case slug. All workflow state lives in a per-task working directory:

```
./tmp/<identifier>/
```

Scoping every artifact under `./tmp/<identifier>/` lets **multiple tasks run in parallel** without their state files colliding. The orchestrator establishes this directory in **Phase 0** (below) and **passes its path to every sub-agent it spawns**. Throughout this skill, `<ws>` is shorthand for `./tmp/<identifier>/`.

State files inside the workspace:

- `<ws>/RESEARCH_OUTPUT.md` — Research findings (written by research node)
- `<ws>/RESEARCH_FOLLOWUP_[id].md` — Targeted follow-up research findings (written by follow-up research sub-agents, folded back into `<ws>/RESEARCH_OUTPUT.md`)
- `<ws>/PLAN_STEPS.md` — Step list with affected files and dependencies (written by plan node). Derived workflow state for the BDD loop — NOT presented for user review.
- `<ws>/implementation-plan.md` — Full implementation plan with Technical Design + Behaviors (written by plan node). This is the artifact the user reviews.
- `<ws>/IMPLEMENTATION_PROGRESS.md` — Progress tracking with test results (written by BDD scenario step node)
- `<ws>/INVESTIGATION_STEP_[N].md` — Per-step investigation findings (written by investigation nodes)
- `<ws>/VALIDATION_STEP_[N].md` — Per-step validation results (written by validation nodes)

The whole `./tmp/` directory should be in `.gitignore`; the per-task folder can be deleted once the task is done.

---

## Phase 0: Establish Task Workspace

**Before writing any notes, spawning any sub-agent, or creating any artifact**, establish the task identifier and working directory. This is the very first thing the orchestrator does.

1. Ask the user for a **task identifier** — a ticket id (e.g. `JIRA-123`, `LINEAR-456`) or any short label for this work.
2. If the user has none, **derive a short kebab-case slug** from the feature request (e.g. `add-trending-markets`) and **confirm it with the user** before proceeding.
3. Create the working directory `./tmp/<identifier>/`.
4. From here on, `<ws>` = `./tmp/<identifier>/`. Use it as the prefix for every state file, and **include this path in every sub-agent prompt** ("The task working directory is `<ws>` — read and write all state files there.").

**Gate:** Do NOT proceed to Phase 1 until the identifier is set, confirmed, and the directory exists.

---

## Phase 1: Research (Convergence Loop)

Research runs as a loop that **keeps spawning targeted sub-agents until no code-answerable threads remain**. The orchestrator never reports "more stuff needs checking" to the user — open code-level threads are resolved by spawning more agents, not by handing them back to the user.

**Round 1 — initial research.** Spawn a sub-agent:

```
Agent(
  description: "Research phase",
  prompt: "Read the instructions in [this skill's directory]/nodes/node-research.md
    and execute them for the following feature request: [user's request].
    The task working directory is <ws> (./tmp/<identifier>/) — read and write all state files there.
    You are the INITIAL research agent. Write findings to <ws>/RESEARCH_OUTPUT.md.
    Report back: number of files read, key patterns found, affected areas, and whether
    the 'Follow-up Investigations Needed' section is empty."
)
```

**After it returns**, read `<ws>/RESEARCH_OUTPUT.md` and look at **Follow-up Investigations Needed**.

**Round 2+ — targeted follow-ups (loop).** While that section is non-empty:

1. Spawn **one targeted sub-agent per follow-up item, all in a single message** so they run in parallel:
   ```
   Agent(
     description: "Follow-up research [id]",
     prompt: "Read the instructions in [this skill's directory]/nodes/node-research.md
       and execute them. The task working directory is <ws> (./tmp/<identifier>/) — read and
       write all state files there. You are a TARGETED FOLLOW-UP agent. Investigate ONLY this item:
       [the follow-up question + starting files from <ws>/RESEARCH_OUTPUT.md].
       Read <ws>/RESEARCH_OUTPUT.md for context. Write findings to <ws>/RESEARCH_FOLLOWUP_[id].md.
       Report back: what you resolved and any new follow-up items you uncovered."
   )
   ```
2. After they return, read every `<ws>/RESEARCH_FOLLOWUP_[id].md`, **fold their findings into `<ws>/RESEARCH_OUTPUT.md`**, and rebuild its "Follow-up Investigations Needed" list from any *new* threads the follow-up agents reported (drop the resolved ones).
3. Repeat from step 1 if the list is non-empty.

**Stop the loop** when "Follow-up Investigations Needed" is empty or after **3 rounds** (safety limit — if still non-empty, note the remaining threads when presenting).

**Then present to the user.** Read the consolidated `<ws>/RESEARCH_OUTPUT.md` and present findings, including only the **Open Questions for the User** (genuine product/requirement decisions).

**Gate:** Ask the user: "Research complete. Continue to planning, or investigate more?"
- If "more" → start a new follow-up round with the user's expanded scope as a follow-up item
- **CRITICAL:** You MUST stop and wait for the user's explicit "continue" before proceeding.

---

## Phase 2: Plan

**Spawn a sub-agent** to run the planning phase:

```
Agent(
  description: "Planning phase",
  prompt: "Read the instructions in [this skill's directory]/nodes/node-plan.md
    and execute them. The task working directory is <ws> (./tmp/<identifier>/) — read and
    write all state files there. Read <ws>/RESEARCH_OUTPUT.md for context.
    Use @create-implementation-plan to create the plan, writing it to <ws>/implementation-plan.md.
    Write the step list to <ws>/PLAN_STEPS.md (include affected files and dependencies per step).
    Report back: the plan summary and number of planned steps."
)
```

**After the sub-agent returns**, present `<ws>/implementation-plan.md` (the rich plan with Technical Design + Behaviors) for user review. **NEVER present `<ws>/PLAN_STEPS.md` for review** — it is derived workflow state for the BDD loop, not the artifact the user reviews.

**Gate:** Do NOT proceed until the user approves the plan.

---

## Phase 3: Investigation (Batched Parallel)

After plan approval, every step gets investigated in deep detail — but do **NOT** spawn one sub-agent per step. Each sub-agent pays a fixed token cost to read the plan and the shared files, so per-step agents multiply that cost without adding insight. **Batch the steps:**

1. Group the steps into batches of **2-4 related steps** — steps that touch the same files/module go in the same batch, so shared context gets read once per batch instead of once per step.
2. Spawn **one sub-agent per batch**. The agent count scales naturally with plan size — do NOT pile more steps into one agent to keep the count down: too many steps in one agent congests its context and slows the phase.

**Spawn the batch sub-agents in a single message so they run in parallel:**

For each batch:
```
Agent(
  description: "Investigate steps [N..M]",
  model: "sonnet",  // mechanical read-and-report work — smaller model reduces cost
  prompt: "Read the instructions in [this skill's directory]/nodes/node-investigation.md
    and execute them. The task working directory is <ws> (./tmp/<identifier>/) — read and
    write all state files there. You are assigned Steps [list]: [behavior descriptions].
    Read <ws>/implementation-plan.md for the full plan context.
    Read <ws>/PLAN_STEPS.md for the step list.
    Investigate your assigned steps one at a time, writing each step's findings to
    <ws>/INVESTIGATION_STEP_[N].md (one file per step — Phase 4 consumes them per step).
    Report back: per-step verdicts (can proceed / needs fixes / needs rework) and any blocking issues."
)
```

**After all sub-agents return:**

1. Read all `<ws>/INVESTIGATION_STEP_[N].md` files
2. Collect all findings: mismatches, conflicts, missing dependencies, already-implemented steps
3. **Fix the plan yourself** — update `<ws>/PLAN_STEPS.md` and `<ws>/implementation-plan.md` to address:
   - Remove steps for behaviors already implemented
   - Fix file paths, type names, or function references that were wrong
   - Reorder steps if dependency issues were found
   - Add missing steps if gaps were identified
   - Resolve conflicts between steps
4. **Present to the user:**
   - What problems were found (grouped by category: already implemented, mismatches, conflicts, missing deps, edge cases)
   - What fixes you applied to the plan
   - The updated plan
5. **Gate:** Wait for user approval of the updated plan before proceeding.

---

## Phase 4: Implementation Loop

This is the core loop — it alternates between BDD scenario steps and quality gates.

### For Each Step

**4a. BDD Scenario Step (run inline in the main session)**

Do NOT spawn a sub-agent for BDD scenario steps. The main session executes them directly:

1. Read `nodes/node-bdd-step.md` for the procedure (only needs to be read once at the start of the loop — keep it in context)
2. Read `<ws>/PLAN_STEPS.md` to find the next pending step
3. Read the corresponding `<ws>/INVESTIGATION_STEP_[N].md` for the curated context (affected files, existing patterns, gotchas) so you don't have to re-investigate
4. Execute the scenario test -> implement -> verify cycle following `node-bdd-step.md`
5. Update `<ws>/PLAN_STEPS.md` and `<ws>/IMPLEMENTATION_PROGRESS.md` when done

After each step:
- If step succeeded → continue to the next pending step (or quality gate)
- If step had issues → ask user for guidance before continuing

**Why inline:** consecutive BDD scenario steps usually touch the same module and reuse the same imports, types, and helpers. A fresh sub-agent per step would re-read those files every time. Running inline keeps that context warm.

**4b. Quality Gate Check**

Every **2-3 completed steps**, **spawn a sub-agent** for the quality gate:

```
Agent(
  description: "Quality gate after steps [X-Y]",
  prompt: "Read the instructions in [this skill's directory]/nodes/node-quality-gate.md
    and execute them. The task working directory is <ws> (./tmp/<identifier>/) — read state
    files there. Review tests and code from the most recent 2-3 steps.
    Report back: quality score, issues found, issues fixed, pass/needs-fixes."
)
```

**After the sub-agent returns**, route based on quality result:
- If `quality: "pass"` → continue to next BDD scenario step
- If `quality: "needs-fixes"` → spawn another sub-agent to fix, then re-check
- **Max 2 quality re-checks** per checkpoint to prevent infinite loops

### Loop Termination

Stop the implementation loop when:
- All planned behaviors are implemented (check against the plan)
- User explicitly says "stop" or "done"
- Step count exceeds 20 (safety limit)

---

## Phase 5: Validation (Batched Parallel)

After all implementation steps are complete, validate every step independently — but as in Phase 3, do **NOT** spawn one sub-agent per step. **Batch the steps:** group **2-4 related steps** (by shared files) per validation sub-agent, one sub-agent per batch. The agent count scales with the plan — don't cram more steps into one agent; too many steps per agent congests its context.

**Spawn the batch sub-agents in a single message so they run in parallel:**

For each batch:
```
Agent(
  description: "Validate steps [N..M]",
  model: "sonnet",  // mechanical read-and-report work — smaller model reduces cost
  prompt: "Read the instructions in [this skill's directory]/nodes/node-validation.md
    and execute them. The task working directory is <ws> (./tmp/<identifier>/) — read and
    write all state files there. You are assigned Steps [list]: [behavior descriptions].
    Read <ws>/implementation-plan.md and <ws>/PLAN_STEPS.md, focusing on the sections
    relevant to your assigned steps. In <ws>/IMPLEMENTATION_PROGRESS.md, read your steps'
    entries plus the entries of steps sharing the same files (for cross-step checks) —
    not the whole file.
    Validate your assigned steps one at a time, writing each step's findings to
    <ws>/VALIDATION_STEP_[N].md (one file per step).
    Report back: per-step verdicts (valid / valid with caveats / invalid) and any issues found."
)
```

**After all sub-agents return:**

1. Read all `<ws>/VALIDATION_STEP_[N].md` files
2. Collect all issues found
3. If any steps are invalid → spawn ONE fix sub-agent covering all the invalid steps (batch them too), then re-validate only those steps
4. Present validation results to the user

---

## Phase 6: Summary

**Spawn a sub-agent** for the final summary:

```
Agent(
  description: "Final summary",
  prompt: "Read the instructions in [this skill's directory]/nodes/node-summary.md
    and execute them. The task working directory is <ws> (./tmp/<identifier>/) — read state
    files there. Read <ws>/RESEARCH_OUTPUT.md, <ws>/PLAN_STEPS.md, and
    <ws>/IMPLEMENTATION_PROGRESS.md. Run the full test suite and linting.
    Report back: complete summary with steps, quality gates, test results, files changed."
)
```

Present the final summary to the user.

---

## Error Handling

- If any sub-agent fails → report the error to the user and ask how to proceed
- If user wants to skip a phase → mark it skipped and proceed
- Keep `<ws>/IMPLEMENTATION_PROGRESS.md` updated so work survives interruptions
- If a sub-agent's context is too large (very complex phase) → break it into multiple smaller sub-agents

## Related Skills

- `@create-implementation-plan` - Used in Phase 2 for plan creation
- `@bdd-design` - Core BDD scenario methodology used in Phase 4
- `@test-quality-reviewer` - Used in quality gate checks
- `@code-refactoring` - Used in quality gate reviews
- `@context7` - Used for library documentation during research
- `@web-search` - Used for broader research during Phase 1
