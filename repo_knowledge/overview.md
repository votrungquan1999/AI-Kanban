# Overview

AI Kanban is an **autonomous task-orchestration loop** with a phone-first review surface. On the surface it is a 4-column kanban board (**Todo → In Progress → Need Review → Done**); the board is just the human interface — *the product is the loop* that turns Todo cards into worked code changes via local Claude Code sessions.

## The loop (conceptually)

1. **Intake** — a human (or, later, a recurring definition) adds Todo cards.
2. **Pickup/dispatch** — a session claims a Todo card atomically (`todo → in_progress`).
3. **Work** — the session reads its assignment *from the board* (the board IS the task queue — no prompt injection), creates per-card git worktree(s), and makes changes on isolated `aikanban/card-N` branches.
4. **Review** — on completion the card moves to `need_review`; the session **parks** (stays alive) so the human can reopen it via Claude Code Remote Control on a phone and steer it, then approve to `done`.

## Critical context: this repo is mostly DESIGN + a thin built slice

The README still says "🚧 Design phase." The substantial artifact in this repo is **documentation/design** (`docs/`), plus a **small, well-tested service + UI + MCP slice** that has actually been built (slices 1–3 and an MCP dispatch slice). Many design docs describe a *scheduler*, *runner*, and *recurring intake* that are **not yet implemented**. When reasoning about behavior, distinguish:

- **Built**: `cards` + `card_events` collections, card CRUD service, status transitions + policy, atomic claim, workspace declaration, parse-on-read DB layer, counters, two MCP servers (the generic dispatch one exposed over **both stdio and an HTTP-Basic-auth-gated remote route `POST /api/mcp`**), and a Next.js board UI (read + add-task + drag-to-move).
- **Design-only / not built**: scheduler reconcile loop, runner/process model, `recurring_defs` + `sources` collections, session URL attachment, card detail drawer, polling component, pty-per-card execution (Candidate 3).

## Execution architecture (the key strategic decision)

The execution mechanism is governed by **[ADR 0001](../docs/adr/0001-execution-architecture-staged.md)**, which **supersedes** the original "use the Claude Agent SDK" plan. A hard billing constraint (per-card sessions MUST bill against the Team Premium subscription, not the post-June-15-2026 metered Agent-SDK pool) forced a staged design:

- **Now — Candidate 2′**: a human-pre-started pool of interactive `claude` sessions; a human dispatches a card by typing `/ai-kanban-work-card <id>` (locally or via Remote Control from a phone). Unambiguously subscription-billed. See [pool-dispatch.md](../docs/design/pool-dispatch.md).
- **Later — Candidate 3**: fresh interactive `claude` per card under a pty (gated on a post-June-15 billing probe).

Everything is built behind a **dispatch adapter seam** so the mechanism can change without touching the rest of the loop.

## Tech stack

- **TypeScript / Node**, **Next.js 16 (App Router, RSC + Server Actions)**, **React 19**
- **MongoDB 7** via the **native driver + Zod** (no ODM) — see [data-models.md](./data-models.md)
- **@modelcontextprotocol/sdk** — two MCP servers expose the service layer to agent sessions
- **shadcn/ui** (`style: base-nova`, `rsc: false`) + **Tailwind v4** + `@dnd-kit` for drag
- **Biome** for lint/format; **Vitest** (unit/integration, in-memory Mongo) + **Playwright** (e2e)

## See also

- [architecture.md](./architecture.md) — system design and the two-surfaces-over-one-service model
- [patterns.md](./patterns.md) — repo-specific conventions (parse-on-read, atomic moves, MCP error mapping)
- [data-models.md](./data-models.md) — collections, indexes, concurrency patterns
- [api-mcp.md](./api-mcp.md) — the service + MCP tool surface
- [local-development.md](./local-development.md) — setup, running, testing
- [development-workflow.md](./development-workflow.md) — the strict TDD/BDD + orchestrated workflow this repo follows
