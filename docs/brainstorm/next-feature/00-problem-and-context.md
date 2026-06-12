# Next Feature — Problem Definition & Context

> Brainstorm to decide **what feature AI-Kanban should build next**. Follows the
> structured-brainstorming methodology (problem → clarify → zoom out → iterate →
> document). Sibling files: [README](./README.md),
> [10-clarifying-questions](./10-clarifying-questions.md) (created after answers).

## Problem Statement

AI-Kanban's **data plane is complete** but its **control plane is empty**. We need
to decide which feature to build next: the one that best advances the product's
core purpose (an autonomous loop that dispatches cards to Claude agent sessions)
given current constraints (a billing-verification gate, solo developer, phone-first
review surface).

The question is not *"is there work to do"* — it is *"which next slice yields the
most value per unit risk/effort right now."*

## Current State (verified 2026-06-03)

**Built and solid — the data plane:**
- Card model + CRUD, monotonic numbering, soft-delete/archive
- Atomic `claim_card` (race-proven), status transition policy (ui any→any; agent legal edges)
- `card_events` audit log (status transitions + field edits, success/failure + error)
- Workspace declaration (idempotent `set_workspace`)
- 4 MCP dispatch tools over stdio **and** authenticated HTTP (`/api/mcp`, deployed on Vercel)
- Full board UI: 4 columns, drag-to-move, detail sheet, inline edit, archive,
  copy-to-dispatch launchpad, add-task dialog, polling
- Parse-on-read DB layer (Zod on the way out of Mongo), Biome + CI

**Designed but NOT built — the control plane & misc:**
- ❌ **Scheduler / reconcile loop** — design in `docs/design/scheduler-runner.md`, no code
- ❌ **Session spawning / runner** — no `claude` process launch; `RunState` fields stored but driven by nothing
- ❌ **Recurring intake** — `recurring_defs`, cron eval, source reads (Notion), dedupe seeding
- ❌ **Crash recovery / reconcile** — no `recover(card)` / `onProcessExit`
- ❌ **Timeline UI** — `card_events` are emitted but never shown in the detail sheet (only open item in `next-actions.md`)

**Current dispatch reality (Candidate 2′):** the human is the dispatcher — pre-starts
a pool of `claude` sessions, copies `/ai-kanban-work-card <id>` from a card, pastes it
into a session. The skill then calls claim → set_workspace → get_context → work →
set_status. Automation level ≈ data layer only.

## Key Constraint — ADR 0001 billing gate

Per `docs/adr/0001-execution-architecture-staged.md`, the fully-autonomous runner
(Candidate 3) is gated on a **billing verification dated ~June 15, 2026** (≈12 days
out). Until resolved, runner work may be partly blocked. This materially affects
sequencing: runner-adjacent prep that is *not* blocked vs. runner work that is.

## Candidate Directions (to be evaluated, not yet chosen)

1. **Autonomous runner / scheduler** — the novel core; highest value, highest risk, billing-gated
2. **Timeline UI** — show `card_events` in the detail sheet; small, unblocked, serves phone-review
3. **Recurring intake** — `recurring_defs` + source + cron; medium; unlocks "standing work"
4. **Runner-prep (unblocked slices of #1)** — reconcile loop skeleton, RunState lifecycle, heartbeat — buildable before billing clears
5. **Board-UX polish** — smaller increments on what we just shipped

## Stakeholders / Impact

- **Human operator (primary user)** — wants less manual dispatching, a real review timeline
- **Claude agent (secondary actor)** — consumes MCP tools; affected by any RunState/lifecycle change
- **Solo developer (you)** — effort/risk budget, TDD discipline, files <300 lines

## Open Questions → see answers in [10-clarifying-questions](./10-clarifying-questions.md)
