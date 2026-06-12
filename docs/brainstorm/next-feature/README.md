# Brainstorm — Next Feature: Recurring Tasks

Decides and shapes the next feature for AI-Kanban. Outcome: a **Recurring Tasks**
capability on its own surface, **executed directly** by a **Claude cloud routine**
that pulls due tasks via **new queue-level MCP tools**, with a **run-history
timeline** for visibility — **repo-less**, so it is **not blocked** by the
ADR-0001 billing gate.

## Read in order

1. [00-problem-and-context](./00-problem-and-context.md) — problem statement,
   verified current state (data plane done, control plane empty), the billing gate.
2. [10-clarifying-questions](./10-clarifying-questions.md) — the Q&A that locked the
   direction (separate surface · execute-directly · repo-less · fold in visibility).
3. [20-zoom-1-shape](./20-zoom-1-shape.md) — widest view; 3 architecture alternatives;
   decision (Alt A: separate surface + Claude routine + queue-level MCP).
4. [30-zoom-2-anatomy](./30-zoom-2-anatomy.md) — data model, MCP tool surface,
   scheduler primitive, run-history/visibility.
5. [40-zoom-3-implementation](./40-zoom-3-implementation.md) — slice ordering, ACs,
   risks, scope boundaries.

## One-paragraph summary

Standing/repeating work enters through a dedicated Recurring surface (never the
board). Each task carries an **instruction**, a **preset-interval schedule**, and
**state**. A **Claude routine** wakes on cron, calls **`list_recurring_due`** over the
deployed HTTP MCP connector, **follows each instruction in its own cloud session**,
and reports back via **`start`/`complete`/`fail`** tools that also write an
append-only **`recurring_runs`** history. Because the work is **repo-less**, it needs
no local worktree and **sidesteps the billing-blocked local runner**. The per-task
**run-history timeline** delivers the operator's most-wanted visibility and doubles
as the prototype for the board's own deferred timeline UI.

## Status

Brainstorm complete and ready for review. Next step (on approval): turn
[40-zoom-3-implementation](./40-zoom-3-implementation.md) into a real plan via
`@create-implementation-plan` / `/orchestrated-feature-dev`.

## Supersedes

The older `recurring_defs → seed a Todo card` sketch in
[../../design/data-model.md](../../design/data-model.md): recurring tasks now
**execute directly** and **never become board cards**.
