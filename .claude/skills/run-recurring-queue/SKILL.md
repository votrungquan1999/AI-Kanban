---
name: run-recurring-queue
description: Runs the AI-Kanban recurring-task queue once — list every due recurring task, then for each one claim it, follow its stored instruction, and report the result back (complete or fail). Invoke when dispatched as the scheduled "recurring queue" routine (a Claude cloud cron run), or when a human says "run the recurring queue" / "process due recurring tasks". Repo-less by design — no git, no local filesystem.
allowed-tools: mcp__ai-kanban-dispatch__list_recurring_due, mcp__ai-kanban-dispatch__start_recurring, mcp__ai-kanban-dispatch__list_recurring_runs, mcp__ai-kanban-dispatch__complete_recurring, mcp__ai-kanban-dispatch__fail_recurring
---

# AI-Kanban: Run the Recurring Queue

You are a scheduled run dispatched to process AI-Kanban's **recurring tasks** — standing work that repeats on a schedule (summaries, checks, reminders, lookups). You have no prior identity and no arguments: you discover the work by asking the server what is due, then do each task's instruction yourself.

The server owns integrity — which tasks are due, the atomic claim, the run-history audit, and rescheduling. You own **doing the instruction**. The work is **repo-less**: these tasks are reminders/lookups/notifications, not code changes. You have no git and no local filesystem — do not assume shell access; use your normal tools (web, MCP connectors, reasoning) to carry out each instruction.

You call the server through five `ai-kanban-dispatch` MCP tools: `list_recurring_due`, `start_recurring`, `list_recurring_runs`, `complete_recurring`, `fail_recurring`.

## Inputs

None. The queue is discovered at run time via `list_recurring_due`. If the list is empty, there is nothing to do — exit cleanly (this is the normal idle case, not an error).

## Flow

Process the queue one task at a time:

1. **List due tasks** — call `list_recurring_due()` (no arguments). It returns `{ tasks: [...] }`, each task carrying at least `id`, `title`, and `instruction`. The server has already filtered to enabled + idle + due tasks, so do not filter further. If `tasks` is empty, stop — you are done.

2. **For each task, claim it** — call `start_recurring(task.id)`. On success the task is now `running` and yours to execute. If the result is an error (`isError: true`), read `structuredContent.code` and **skip this task** — do NOT retry the claim in a loop:
   - `ERR_ALREADY_RUNNING` — another run owns it (or it is parked failed); leave it.
   - `ERR_NOT_DUE` — it became disabled or not-yet-due since the list; leave it.
   - `ERR_NOT_FOUND` — it was deleted; leave it.
   Then continue to the next task.

3. **Read recent history for continuity (when it helps)** — after a successful claim, you MAY call `list_recurring_runs(task.id)` to read the task's latest runs, newest first (default 5, max 20 via `limit`). Prior completion notes are the task's run-to-run memory: if the instruction builds on earlier runs (a tracked position, a running tally, "continue from where you left off"), read the latest note and continue from it instead of starting blind. A first-ever run simply returns an empty history.

   **Excluding idle-window markers — `excludeNotePrefix`.** Tasks that skip themselves outside an active window (e.g. a market-hours task that writes `skipped — outside VN trading window` when closed) emit runs of pure noise that carry no state. Between active sessions these skip notes pile up and can fill the read window, burying the last note that actually holds state — so the first run of the next session reads only skips and wrongly restarts from scratch. To avoid this, pass `excludeNotePrefix` to drop runs whose note starts with that string, and widen the window: `list_recurring_runs(task.id, { limit: 20, excludeNotePrefix: "skipped" })`. The filter is applied at the query level, so the limit is spent on real runs — you get the latest notes that actually carry continuity, not the skip markers. Use the prefix the task itself writes for its skips (read the instruction). A task whose instruction defines such a skip note SHOULD tell you to read history this way.

4. **Follow the instruction** — read the claimed task's `instruction` and carry it out using your available tools. This is repo-less reminder/lookup/notification work.

5. **Report the result explicitly** — exactly one of:
   - **Success** → `complete_recurring(task.id, { note })` with a short note describing what you did. The server flips it back to `idle` and rolls its next due time forward. If future runs need state you produced (positions, totals, watchlists), write it INTO the note — the note is what the next run reads via `list_recurring_runs`.
   - **Failure** → `fail_recurring(task.id, { error })` with a short reason. The server marks it `failed` and parks it; it will NOT run again until a human resets it from the board.

6. **Move to the next task** until the list is exhausted, then exit.

## Critical Rules

**DO:**
- Discover work only through `list_recurring_due` — never invent task ids.
- Report every claimed task with an **explicit** `complete_recurring` or `fail_recurring` call. A clean run exit is NOT a success signal — the server only knows the outcome you tell it.
- Isolate failures per task: one task failing (or a claim that loses) must not abort the rest of the queue. Branch on `isError` and continue the loop.
- Keep notes/errors human-readable — they appear in the task's run-history timeline for the operator. Lead with a short summary line; if the task carries state between runs, append it after the summary (the note doubles as the next run's memory via `list_recurring_runs`).

**DO NOT:**
- Retry a lost claim in a loop — skip the task and move on.
- Assume git, a shell, or a local filesystem — recurring tasks are repo-less.
- Auto-retry a failed task — failure is terminal until the operator resets it.
- Filter the due list yourself — the server already decided what is due.
