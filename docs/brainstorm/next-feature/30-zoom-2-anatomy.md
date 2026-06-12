# Zoom 2 — Anatomy: data model, MCP surface, scheduler, visibility

> Parent: [00-problem](./00-problem-and-context.md) · Prev:
> [20-zoom-1-shape](./20-zoom-1-shape.md) · Next:
> [40-zoom-3-implementation](./40-zoom-3-implementation.md). Builds on **Alt A**.

Four parts to detail: [§1 data model](#1-data-model), [§2 MCP tools](#2-mcp-tool-surface),
[§3 scheduler](#3-the-claude-scheduler), [§4 visibility](#4-visibility--run-history).

## 1. Data model

A new collection, **`recurring_tasks`** — deliberately *not* `cards` (separate
surface). Mirrors the `cards` conventions (Zod parse-on-read, mapper to a client
shape, monotonic `number`).

| Field | Type | Notes |
| --- | --- | --- |
| `_id` / `number` | ObjectId / int | monotonic, like cards (`counters`) |
| `title` | string | short label for the surface |
| `instruction` | string | the prompt the scheduler **follows** (the "what to do") |
| `schedule` | see below | when it becomes due |
| `enabled` | boolean | paused tasks are never due |
| `runState` | enum | `idle` / `running` (a routine is executing it now) |
| `lastRunAt` | Date \| null | last execution start |
| `lastOutcome` | enum \| null | `success` / `failure` of the last run |
| `nextDueAt` | Date \| null | computed; the dueness cursor |
| `createdAt`/`updatedAt` | Date | standard |

**Schedule grammar — two alternatives:**

- **Alt 1 (preset intervals):** `{ everyHours: number }` or an enum
  (`hourly`/`daily`/`weekly`). Simple to author on a phone, trivial `nextDueAt`
  math, no parser. **Leaning this way** for the first slice (routine floor is ~1h
  anyway, so fine-grained cron buys nothing).
- **Alt 2 (cron string):** full `"0 9 * * *"` flexibility, but needs a cron lib +
  validation UI and is overkill for repo-less reminders. Defer.

**"Not done yet" semantics:** a task is **due** when
`enabled && nextDueAt <= now && runState !== running`. After a successful run, the
service computes the next `nextDueAt` from the schedule (period rolls forward). A
failure leaves it due for retry on the next wake (or backs off — decide in
implementation).

## 2. MCP tool surface

The gap the research flagged: today's tools are all single-`id`
([deploy-claude-scheduler §5](../../research/deploy-claude-scheduler.md)). A routine
fired generically needs **queue-level** tools. Add, alongside the existing dispatch
tools, a small recurring set:

- **`list_recurring_due()`** → the due tasks (id, title, instruction). The routine's
  entry point each wake.
- **`start_recurring(id)`** → atomic `idle → running` (single `findOneAndUpdate`,
  same race-proof pattern as `claim_card`); returns the instruction. Idempotent
  loser → readable error (guards the routine's no-idempotency-key caveat).
- **`complete_recurring(id, { note? })`** → mark success, roll `nextDueAt`, write a
  run-history row.
- **`fail_recurring(id, { error })`** → mark failure, write a run-history row, leave
  due for retry.

These live in the same `dispatch-tools` registration so they're exposed over **both**
stdio and the **HTTP connector** the routine uses. Auth is the existing Basic gate on
`/api/mcp` — no new auth surface.

**Why start/complete (not just a single `run`):** splitting claim from completion
makes a crashed/timed-out routine run **recoverable** (a task stuck `running` past a
threshold can be reclaimed) and gives the run-history honest start/end + outcome —
exactly the visibility the user asked for.

## 3. The Claude scheduler

**Chosen primitive: a Claude Code _routine_ (cloud cron).** Why, from the
[capability matrix](../../research/claude-scheduling-capabilities.md):

| Primitive | Unattended | Reaches our HTTP MCP | Per-run reviewable URL | Fit |
| --- | --- | --- | --- | --- |
| **Routine** | ✅ persistent cron | ✅ connector proxied by Anthropic | ✅ | **best** |
| `/loop` | ❌ needs open terminal, ~7d expiry | ✅ | shares one session | dev poller only |
| Background agent | ⚠️ needs a supervisor + external cron | ✅ | ✅ | needs the scheduler we're avoiding |

Repo-less work removes the routines' biggest drawback (no local FS), so the routine's
cloud sandbox is a non-issue. **Mapping:** one cron routine, prompt ≈ *"Call
`list_recurring_due`. For each task, follow its `instruction`, then call
`complete_recurring` (or `fail_recurring`)."* Bundle that prompt as a tiny skill the
routine runs.

**Caveats to honor:** ~1h cron floor; per-account routine run cap + subscription
usage; a green routine run ≠ task success (so `complete/fail` must be **explicit**
tool calls, not inferred from run exit). All acceptable for recurring semantics.

**Connector registration** is a one-time setup step (like the
`claude mcp add --transport http … --header "Authorization: Basic …"` we already use),
plus adding the recurring tools to the routine's connector allowlist.

## 4. Visibility / run-history

The acute pain. Two storage alternatives:

- **Alt 1 (sibling collection `recurring_runs`):** append-only rows
  `{ recurringId, at, startedAt, finishedAt, outcome, note, error }`, index
  `{ recurringId: 1, at: 1 }`. Mirrors `card_events` exactly (same `emit*` +
  `list*` shape, reusable test patterns). **Leaning this way** — clean separation
  from card audit, same proven pattern.
- **Alt 2 (extend `card_events`):** add a recurring-flavored event kind. Reuses one
  collection but muddies card-scoped queries and the discriminated union. Reject.

**Surface UI:** the separate **Recurring** page lists tasks; tapping one opens a
detail with its **run history** (timeline of runs, success/failure, relative age via
the existing `formatRelativeAge`, the `note`/`error` shown). This is the
phone-review visibility the user wanted — *what the scheduler did, when, and whether
it worked* — built from the same primitives as the board's (deferred) timeline UI,
so it doubles as the prototype for that.

## Open refinements → [zoom-3](./40-zoom-3-implementation.md)

- Failure backoff vs immediate-retry-next-wake.
- Reclaim threshold for a `running` task whose routine died.
- Whether `instruction` results need richer storage than a short `note`.
