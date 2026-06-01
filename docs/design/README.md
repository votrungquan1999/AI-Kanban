# AI Kanban — Design Docs

Design/specification for the repo. These supersede the exploratory [brainstorm](../brainstorm/brainstorm-ai-kanban.md) docs where they conflict.

## What this system is

An **autonomous task-orchestration loop** with a phone-first review surface (a 4-column kanban board). The board is the human interface; the product is the loop that pulls Todo cards → spawns local Claude Code (Remote Control) sessions → routes results to Need Review / Done. Full context: [problem](../brainstorm/brainstorm-ai-kanban.md), [solutions](../brainstorm/brainstorm-ai-kanban-solutions.md), [architecture](../brainstorm/brainstorm-ai-kanban-architecture.md).

## Locked decisions (carried from brainstorm)

- **Path C** — minimal custom board, all review in claude.ai Remote Control (phone).
- **Stack** — TypeScript / Node. ⚠️ The **execution mechanism** (how per-card sessions are spawned/driven) is **superseded by [ADR 0001](../adr/0001-execution-architecture-staged.md)**: reused interactive sessions + a `/work-card` skill now, pty-per-card later. The Claude **Agent SDK is *not* used to drive sessions** — it bills to the post-June-15 metered pool, violating the subscription-billing constraint. See the ADR for the full rationale.
- **Persistence** — **MongoDB** (changed from the brainstorm's SQLite→Postgres). See [data-model.md](./data-model.md).
- **Per-card multi-repo workspace** — folder per card under `workspaces/`, one git worktree per repo, branch `aikanban/card-<number>`. Repos chosen at pickup, user-confirmed.
- **Permissions** — broad/auto for autonomy; gate via prompt-defined prohibitions (no hard gates). See architecture doc's "Side-effect & Permission Policy".

## Design docs

| Doc | Covers | Status |
| --- | ------ | ------ |
| [data-model.md](./data-model.md) | MongoDB collections (incl. implemented `card_events` audit log), embedding, indexes, atomic patterns, parse-on-read layer | draft |
| [mcp-api-contract.md](./mcp-api-contract.md) | The tool surface: signatures, callers, agent scoping, transitions | draft |
| [scheduler-runner.md](./scheduler-runner.md) | Reconcile loop, two-axis state, per-card process model, crash recovery | draft |
| [bootstrap-prompt.md](./bootstrap-prompt.md) | The generic, resume-aware prompt injected into every session | draft |
| [web-ui.md](./web-ui.md) | Next.js board: RSC reads, Server Action writes, polling, drag, card detail | draft |
| [next-actions.md](./next-actions.md) | Engineering hygiene (Biome + CI), audit/event log, parse-on-read DB wrapper — **all implemented in Slice 3**; timeline UI still open | done (1 thread open) |
| [pool-dispatch.md](./pool-dispatch.md) | Candidate 2′ operating model: away-from-machine constraint, human/by-id dispatch, no software WIP cap, `WORKER_ID` + lease, claim/worktree/skill scope, deferred items | spec |

_(more to come: recurring intake / Notion source)_

## Decisions (ADRs)

- [adr/](../adr/README.md) — dated architecture decision records. **[ADR 0001](../adr/0001-execution-architecture-staged.md)** sets the staged execution architecture (reused-session dispatch now → pty-per-card later) and supersedes the old "Agent SDK" execution mechanism.

## Research

- [research/](../research/README.md) — **build a custom scheduler vs. leverage Claude's
  routines** (capabilities, cost, and deployment for both routes). Conclusion: build a
  *thin* runner that spawns `claude --bg` per card; routines are remote and break the
  local-first keystone.
