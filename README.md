# AI Kanban

An **autonomous task-orchestration loop** with a phone-first review surface.

On the surface it's a 4-column kanban board (**Todo → In Progress → Need Review → Done**). Underneath, a scheduler periodically pulls Todo cards, spawns **local Claude Code sessions** (via [Remote Control](https://code.claude.com/docs/en/remote-control.md)) to work them, and routes the result to **Need Review** — where each card links to a live `claude.ai` session you can read and steer **from your phone** — or straight to **Done**.

The board is just the human interface. The product is the loop.

> **Status:** 🚧 Design phase — greenfield, no implementation yet. See [docs/design](./docs/design/README.md).

---

## How it works

1. **Intake** — add one-time tasks, or **recurring definitions** (e.g. "poll Notion, pick the top-2 by priority") that generate Todo cards on a schedule.
2. **Pickup** — a reconcile loop claims Todo cards (up to a WIP limit) and, for each, creates a **per-card workspace** containing a git **worktree of every relevant repo**, then launches a Remote Control session.
3. **Work** — the agent reads its assignment from the board (the board *is* the task queue), confirms which repos it needs **with you**, makes changes on isolated `aikanban/card-N` branches, and moves its own card when done.
4. **Review** — `need_review` cards keep their session **alive**; you open the `claude.ai` link on your phone, chat to steer, and the agent self-moves to Done when you approve.

## Key ideas

- **Multi-repo per-card workspaces** — one task can change several repos at once; each card gets isolated worktrees so concurrent cards never collide.
- **The agent is an MCP client** — each session gets a board MCP scoped to its own card, so it moves itself between columns.
- **Reconcile loop** — the scheduler converges desired vs. actual state each tick; crash recovery is just an invariant (a dead session auto-restarts fresh from the surviving worktree).
- **Autonomy-first permissions** — broad/auto execution gated by prompt-defined prohibitions, not hard gates.

## Stack

- **TypeScript / Node** — [Claude Agent SDK (TS)](https://code.claude.com/docs/en/agent-sdk/overview.md)
- **MongoDB** — native driver + [Zod](https://zod.dev) (no ODM)
- **Claude Code Remote Control** (Pro/Max) — local execution, phone review

## Documentation

| Area | Docs |
| ---- | ---- |
| **Design** (authoritative) | [overview](./docs/design/README.md) · [data model](./docs/design/data-model.md) · [MCP/API contract](./docs/design/mcp-api-contract.md) · [scheduler & runner](./docs/design/scheduler-runner.md) |
| **Brainstorm** (exploration / history) | [problem](./docs/brainstorm/brainstorm-ai-kanban.md) · [solutions](./docs/brainstorm/brainstorm-ai-kanban-solutions.md) · [architecture](./docs/brainstorm/brainstorm-ai-kanban-architecture.md) |

## Repo layout

```
docs/
  design/       authoritative design specs
  brainstorm/   exploratory thinking (history)
workspaces/     per-card git worktrees (gitignored, created at runtime)
```
