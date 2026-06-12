# Zoom 3 — Implementation shape (slices, ACs, risks)

> Parent: [00-problem](./00-problem-and-context.md) · Prev:
> [30-zoom-2-anatomy](./30-zoom-2-anatomy.md). This is a **brainstorm sketch**, not
> the implementation plan — the real plan comes from `@create-implementation-plan` /
> `/orchestrated-feature-dev` after this is approved. Steps are behaviors + ACs +
> test type only (no test code, no signatures), per the feature-development guide.

## Slice ordering (data → tools → scheduler → UI → visibility)

Each slice is independently shippable and leaves the system green. Mirrors how the
board feature was sliced.

### Slice 1 — `recurring_tasks` model + service
**Behavior:** an operator capability to create/list/enable/disable a recurring task
with a title, instruction, and preset-interval schedule; the service computes
dueness (`nextDueAt`) and exposes "list due".
**AC:** creating a task persists it with a monotonic number and a computed
`nextDueAt`; listing due returns only `enabled && nextDueAt<=now && !running`;
parse-on-read validates the stored shape.
**Test type:** unit (service + schema), with in-memory Mongo.
**Deps:** none. Reuses `counters`, `find-z`, Zod conventions.

### Slice 2 — queue-level MCP tools
**Behavior:** an agent/scheduler capability to `list_recurring_due`,
`start_recurring` (atomic claim), `complete_recurring`, `fail_recurring` over the
existing connector.
**AC:** `start_recurring` moves exactly one caller to `running` under concurrency
(race-proven like `claim_card`); `complete` rolls `nextDueAt` and is reflected in a
follow-up `list_due`; `fail` leaves the task due; all return readable results (no
throws) like the existing dispatch tools.
**Test type:** integration (tool handlers against in-memory Mongo), incl. a
concurrent-start race test.
**Deps:** Slice 1.

### Slice 3 — Recurring surface UI (separate from the board)
**Behavior:** an operator capability to view the recurring tasks on their own page,
create one via a form, and toggle enabled — phone-first, never on the board.
**AC:** the page lists tasks with title/schedule/next-due/last-outcome; a create
form adds one (server action) and it appears; toggling enabled persists and is
reflected; the board is unaffected.
**Test type:** component/integration (RSC read + server action), Base-UI patterns.
**Deps:** Slice 1.

### Slice 4 — run-history (`recurring_runs`) + visibility timeline
**Behavior:** every `start`/`complete`/`fail` writes an append-only run row; the
task detail shows a **run-history timeline** (what ran, when, success/failure, note/
error) — the operator's visibility into agent actions.
**AC:** a completed run writes one success row with start/finish; a failed run writes
one failure row carrying the error; the detail reads them back newest-first with
relative ages; a task with no runs shows an empty state.
**Test type:** integration (emit + list) + component (timeline render).
**Deps:** Slices 2 + 3. *This is the slice that pays off the acute pain.*

### Slice 5 — the Claude scheduler wiring (routine + skill)
**Behavior:** a Claude routine, on cron, runs a small skill that calls
`list_recurring_due`, follows each `instruction`, and reports via
`complete`/`fail`.
**AC (mostly manual/integration):** with the connector registered, a manual routine
fire processes all due tasks and their run-history + `nextDueAt` update correctly;
the skill prompt is committed; setup (connector registration, allowlist) is
documented. No app-code gate depends on a live routine for CI.
**Test type:** integration for the skill's tool-call contract; manual verification of
the live routine (documented, not CI-gated — honors "never require running the
server").
**Deps:** Slice 2 (tools) + the deployed connector.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Routine has **no idempotency key** → duplicate runs | `start_recurring` atomic claim makes a duplicate fire a no-op loser |
| Routine **~1h cron floor** | acceptable for recurring; documented; sub-hour would need Alt C runner |
| A routine **dies mid-run** (task stuck `running`) | reclaim-after-threshold rule (refine in plan); split start/complete makes this detectable |
| Routine **caps / subscription usage** | one batched routine (list-all-due) instead of one routine per task |
| **Billing gate** creep | repo-less keeps it out of the local-runner path; if a task ever needs local repos, it belongs on the board (Alt B), not here |
| Green run ≠ success | `complete`/`fail` are **explicit** tool calls, never inferred |

## Explicitly out of scope (first pass)

- Cron-string schedules (preset intervals only) · failure notifications/alerting ·
  rich run-output storage beyond a short note · recurring tasks that touch local or
  GitHub repos (those are board cards, not recurring tasks) · sub-hour cadence.

## What this unblocks

Ships **standing work** without the blocked local runner, gives the operator the
**visibility** they most want, and builds the **run-history timeline** primitive that
the board's own deferred timeline UI can later reuse — three of the project's open
threads advanced by one repo-less, billing-gate-free feature.
