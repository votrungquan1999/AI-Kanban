# AI Kanban — Design Docs

Design/specification for the repo. These supersede the exploratory [brainstorm](../brainstorm/brainstorm-ai-kanban.md) docs where they conflict.

## What this system is

An **autonomous task-orchestration loop** with a phone-first review surface (a 4-column kanban board). The board is the human interface; the product is the loop that pulls Todo cards → spawns local Claude Code (Remote Control) sessions → routes results to Need Review / Done. Full context: [problem](../brainstorm/brainstorm-ai-kanban.md), [solutions](../brainstorm/brainstorm-ai-kanban-solutions.md), [architecture](../brainstorm/brainstorm-ai-kanban-architecture.md).

## Locked decisions (carried from brainstorm)

- **Path C** — minimal custom board, all review in claude.ai Remote Control (phone).
- **Stack** — TypeScript / Node (Claude Agent SDK TS).
- **Persistence** — **MongoDB** (changed from the brainstorm's SQLite→Postgres). See [data-model.md](./data-model.md).
- **Per-card multi-repo workspace** — folder per card under `workspaces/`, one git worktree per repo, branch `aikanban/card-<number>`. Repos chosen at pickup, user-confirmed.
- **Permissions** — broad/auto for autonomy; gate via prompt-defined prohibitions (no hard gates). See architecture doc's "Side-effect & Permission Policy".

## Design docs

| Doc | Covers | Status |
| --- | ------ | ------ |
| [data-model.md](./data-model.md) | MongoDB collections, embedding, indexes, atomic patterns | draft |
| [mcp-api-contract.md](./mcp-api-contract.md) | The tool surface: signatures, callers, agent scoping, transitions | draft |
| [scheduler-runner.md](./scheduler-runner.md) | Reconcile loop, two-axis state, per-card process model, crash recovery | draft |

_(more to come: bootstrap prompt, repo skeleton)_
