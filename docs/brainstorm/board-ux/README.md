# Board UX Brainstorm — Dispatch Launchpad

Making the AI-Kanban board do its real job: **triage + one-gesture dispatch** of a card to a Claude session (`/ai-kanban-work-card <id>`), plus a richer card and a detail view, phone-first.

## Reading order

1. [00 — Problem & context](./00-problem-and-context.md) — why the board exists, current state, the copy-dispatch reframing, constraints.
2. [10 — Clarifying questions & answers](./10-clarifying-questions.md) — decisions + derived principles.
3. [20 — Zoom 1: launchpad shape](./20-zoom-1-launchpad-shape.md) — tile-centric vs detail-centric vs **hybrid (chosen)**.
4. [30 — Zoom 2: anatomy](./30-zoom-2-anatomy.md) — tile, detail sheet, copy dropdown; touch drag-handle decision.
5. [40 — Zoom 3: implementation & slices](./40-zoom-3-implementation.md) — files, new backend, 7 build slices A–G.

## Headline decisions

- **Hybrid shape**: lean tile with a one-tap quick-copy; a URL-driven **detail sheet** as the workbench.
- **Phone-first**: explicit drag handle, tap-to-open, big copy targets, no hover dependence.
- **Copy dropdown**: prompt (default) / raw id / per-field copy.
- **Edit** title/description/priority + **manual status move** + **delete/archive** + **copy fields** live in the sheet.
- **Slice A (copy-to-dispatch) first** — it's the actual pain and needs zero backend.
