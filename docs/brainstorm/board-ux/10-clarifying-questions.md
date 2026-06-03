# Clarifying Questions & Answers

> Part of the [board-ux brainstorm](./00-problem-and-context.md). These answers constrain the [zoom layers](./20-zoom-1-launchpad-shape.md).

---

## Round 1 — copy & scope

**Q: What should land on the clipboard when you copy on a card?**
**A:** A **dropdown** lets the user choose — either the Claude prompt (`/ai-kanban-work-card <id>`) or the raw `<id>`.

**Q: How wide is "make it work better"?**
**A:** Broad. Add description, more fields on the card, a **card detail view**, and generally match the UX of mature kanban boards.

## Round 2 — direction-setters

**Q: Primary device for the copy→dispatch gesture?**
**A:** **Phone mainly.** Triage and dispatch happen via Remote Control on a phone. → Touch-first: big tap targets, tap-to-open detail sheet, **no reliance on hover**. Desktop can get hover shortcuts as a bonus, but touch is the design center.

**Q: Editing cards, or read + dispatch only?**
**A:** **Edit core fields too.** The detail view should edit at least title, description, priority via Server Actions.

**Q: How to treat not-yet-built fields (runState, session_url, lastError)?**
**A:** **Free to display more in the FE, as long as the UX for them is clean.** Not limited to currently-built fields — may surface/derive richer info, but cleanliness of UX is the gate. (Pragmatic reading: prefer fields that are cheap to populate; don't bolt on a half-built scheduler just to show a badge.)

**Q: Which manual actions belong in the card detail view?**
**A:** **Manual status move**, **Delete / archive card**, and **Copy individual fields** (id, worktree path, branch, …). (Open-repo/worktree links was *not* selected — copy-field covers pasting a path into a shell.)

---

## Derived design principles

1. **Touch-first launchpad.** Every primary action reachable by tap; copy and dispatch must work without a keyboard or hover. Desktop hover is additive, never required.
2. **One-gesture dispatch.** From seeing a card to having `/ai-kanban-work-card <id>` on the clipboard should be one tap (with a dropdown to switch what's copied).
3. **Thin board, richer card.** The *board* stays a triage surface; the *card detail* is where richer fields, edits, and actions concentrate — so the columns don't get heavy.
4. **Clean over complete.** Show more fields only where the presentation is clean; a cramped tile is worse than a sparse one. Detail view absorbs the long tail.
5. **Built-first, future-marked.** Center on fields that exist or are cheap to populate; clearly mark anything speculative (session/runState) as a future slot, don't fake it.

## Still-open (defer into solution layers, not blocking)

- Exact polling/refresh behavior for the detail sheet (inherit board `Poller` vs self-poll).
- Delete vs archive semantics (hard delete + `card_events` audit? soft `archived` status/flag?).
- Whether tags/labels are worth a new backend field or out of scope for v1.
