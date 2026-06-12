# Clarifying Questions & Answers

> Captured before idea generation (per brainstorming rules). Parent:
> [00-problem-and-context](./00-problem-and-context.md). Next:
> [20-zoom-1-shape](./20-zoom-1-shape.md).

## Round 1 — direction

**Q1. What should the next feature optimize for?**
A: **Recurring work.** Recurring tasks should be **separated from the main kanban
board**. Create a **scheduler on Claude** that uses the **MCP** to **pull recurring
tasks that aren't done yet** and **follow the instructions there**.

**Q2. Status of the ADR-0001 billing gate (full local runner)?**
A: **Still blocked.** → Avoid anything that depends on launching local,
billing-verified Claude sessions.

**Q3. Scope/size of the slice?**
A: **Any — don't worry about size.**

**Q4. Most acute operator pain today?**
A: **No visibility into agent actions.**

## Round 2 — verifying the recurring design

**Q5. When a recurring task is due, what happens to it?**
A: **Execute directly.** The Claude scheduler reads the task's own instruction and
does the work itself, then marks that task done/handled. Recurring tasks live
entirely in their own surface — they do **not** appear as board cards.

> This **supersedes** the older `recurring_defs → seed a Todo card` sketch in
> [data-model.md](../../design/data-model.md). We are NOT seeding board cards.

**Q6. What kind of work will recurring tasks do?**
A: **Repo-less / general** — summaries, checks, reminders, lookups, notifications.
No local files. → Runs cleanly on Claude's **cloud cron (routines)** through the
**deployed HTTP MCP connector** (`/api/mcp`). This is the key unlock: repo-less work
needs no local worktree, so it **does not touch the billing-gated local runner**.

**Q7. Fold visibility/timeline into this feature?**
A: **Yes.** Each recurring task shows a **run history** (what the scheduler did,
when, success/failure), reusing the `card_events` audit pattern. This directly
addresses the acute pain from Q4.

## Resulting problem statement (sharpened)

> Build a **Recurring Tasks** capability that lives on its own surface (not the
> board). Each recurring task carries an **instruction**, a **schedule**, and a
> **state**. A **Claude-native scheduler** (cloud routine) periodically pulls the
> **due, not-yet-done** tasks via **new queue-level MCP tools** over the existing
> HTTP connector, **executes each instruction directly**, and records a
> **run-history** that is **visible** per task. Repo-less by design, so it is
> **unblocked by the billing gate**.

## Deferred / assumed (open during brainstorm, flagged for later)

- Exact recurrence grammar (cron string vs simple interval presets) — explore in
  [zoom-2](./30-zoom-2-anatomy.md).
- Which Claude scheduler primitive (routine vs `/loop` vs background agent) —
  evaluated in [zoom-2](./30-zoom-2-anatomy.md).
- Whether run output/results need storage beyond success/failure + a short note.
- Notifications on failure (out of scope unless raised).
