# Brainstorm: Board UX as a Dispatch Launchpad

> Series root. Sibling files: [10-clarifying-questions.md](./10-clarifying-questions.md) · [20-zoom-1-board-purpose.md](./20-zoom-1-board-purpose.md) (later) · solution layers (later).
> Grounded in: [overview](../../../repo_knowledge/overview.md) · [web-ui.md](../../design/web-ui.md) · [pool-dispatch.md](../../design/pool-dispatch.md) · [ADR 0001](../../adr/0001-execution-architecture-staged.md) · work-card skill.

---

## Problem statement

The board is too thin to do the one job it exists for. **A human cannot dispatch a card to a Claude session from the board itself.** The thing the agent needs — the card's 24-hex `id`, ideally wrapped as `/ai-kanban-work-card <id>` — is never shown and never copyable. To work a card today you must leave the board and query Mongo for the id. The card tile also shows almost nothing (number, priority badge, title), there is no detail view, and the UX is far behind mature kanban boards.

We want to make the board a real **dispatch launchpad**: see enough to triage, then dispatch a card to an agent in one gesture.

## Why this board exists (the usage)

From [overview](../../../repo_knowledge/overview.md) and [ADR 0001](../../adr/0001-execution-architecture-staged.md):

- The product is **the loop**: Todo cards → worked code changes via local Claude Code sessions. The board is just the human surface for that loop.
- Current execution model is **Candidate 2′** ([pool-dispatch.md](../../design/pool-dispatch.md)): a human keeps a pool of pre-started interactive `claude` sessions and dispatches a card by typing **`/ai-kanban-work-card <id>`** — locally on desktop, or via **Remote Control from a phone**. (Subscription-billing constraint forces this; the SDK auto-runner is deferred.)
- So the board's job is **triage + dispatch**, where "dispatch" today literally means *getting `/ai-kanban-work-card <id>` into a session's input*. Copy-to-clipboard is the missing primitive.

## Current state (what's built)

- **Card tile** ([card.ui.tsx](../../../app/(board)/card.ui.tsx)): `#number`, a `P{priority}` badge, and the title. Nothing else.
- **Board** ([board.tsx](../../../app/(board)/board.tsx)): 4 columns, dnd-kit drag-to-move with optimistic update + Server Action. `card.id` is used only as the internal drag handle.
- **Add task** dialog exists; drag-to-move exists. No detail view, no copy, no edit, no polling component yet.
- **Card data available now** ([card.type.ts](../../../app/(board)/../../src/cards/card.type.ts) `Card`): `id, number, title, description?, status, priority, origin, createdAt, updatedAt, pickedAt, finishedAt, workspacePath, repos[]`.
  - `repos[]` = `{ repo, branch, worktreePath }` — the worktrees the agent declared via `set_workspace`.
  - Design-only fields (NOT built): `runState`, `session_url`, `lastError`, `process`. The original [web-ui.md](../../design/web-ui.md) tile/drawer leaned on these.

## The reframing this brainstorm must carry

The old [web-ui.md](../../design/web-ui.md) drawer centered on **"Open session → `session_url`"** (the scheduler/runner model). Under the *current* dispatch model there is no `session_url` to open at dispatch time — instead the human **copies the command into a session they already have open**. Every idea below should re-center the launchpad on **copy-to-dispatch**, and treat `session_url`/`runState` as future, not present.

## Constraints & requirements

**Hard (from repo rules & architecture):**
- Next.js App Router, **RSC reads / Server-Action writes**; no client-side data fetching in Server Components.
- **shadcn/ui only** for components (`npx shadcn add`); Tailwind v4, tokenized colors, `grid`-first, `size-*`, no `absolute` (use `pile`).
- File-structure split: `*.tsx` (server) / `*.ui.tsx` (client display) / `*.state.tsx` (state) / `*.type.ts`. Files **< 300 lines**.
- **URL state** for drawer/dialog open-state (`?card=<id>`), handled server-side (per url-state-management rule + web-ui.md).
- **Mobile-first** — phone triage + Remote Control dispatch is a first-class path.
- **Keep the board thin** — deep review still lives in claude.ai, not here.
- TDD/BDD test-first; the user handles `build`/`dev`; no new deps without `npm install`.

**Soft / to confirm (see [clarifying questions](./10-clarifying-questions.md)):**
- Whether editing cards (title/description/priority) is in scope, or read + dispatch only.
- Whether to surface only built fields, or also build new ones.
- Primary device for the copy-dispatch gesture (desktop vs phone) and clipboard behavior there.

## Stakeholders & impact

- **The operator (you)** — single user; triages and dispatches, on desktop and phone.
- **The agent session** — consumes the dispatched command; needs the exact id/prompt.
- **Downstream design docs** — [web-ui.md](../../design/web-ui.md) will need an update to reflect the copy-dispatch reframing once this brainstorm lands.

## Initial hypotheses (to expand in solution layers)

1. The single highest-value change is a **per-card copy control with a small menu** (copy `/ai-kanban-work-card <id>` vs copy raw id) — the user already chose a dropdown.
2. A **card detail view** (drawer, URL-driven) is where richer fields + the dispatch command + manual actions naturally live, mirroring mature kanban boards.
3. The **tile** should grow just enough to triage (description snippet, repo/branch chips, age) without becoming heavy.

## Success criteria (draft — confirm in questions)

- Dispatch a card from the board in **one gesture**, on desktop and phone, with zero Mongo spelunking.
- Card tile + detail show enough to decide *what to work next* and *what state a card is in*.
- No regression to the thin-board principle; deep work/review still in claude.ai.
