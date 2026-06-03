# Zoom Layer 1 — The Widest View: What Shape Is the Launchpad?

> Part of the [board-ux brainstorm](./00-problem-and-context.md). Constrained by [the answers](./10-clarifying-questions.md). Next: [Zoom 2 — anatomy](./30-zoom-2-anatomy.md).

At the widest level the question is **how a human gets from "looking at the board" to "an agent is working this card."** Three structural shapes, independent of pixels.

---

## Alternative A — Tile-centric (copy lives on every tile)

Every card tile carries its own dispatch control (a copy split-button with a dropdown). Detail view exists but is secondary; you can dispatch without ever opening it.

**Pros**

- Fewest taps for the _common_ case: dispatch a known card straight from the column.
- Matches "launchpad" literally — the board IS the dispatcher.

**Cons**

- Tiles get busier; on a phone column, a per-tile split-button + dropdown competes with tap-to-open and drag.
- Copy affordance repeated N times; small touch targets risk mis-taps next to the drag handle.

**Principle:** optimize the _frequent_ path (dispatch) over the _occasional_ path (inspect).

---

## Alternative B — Detail-centric (copy lives in the detail sheet)

Tile stays lean (richer, but no action buttons). **Tap a card → detail sheet** that holds the dispatch dropdown, fields, edit, status move, delete, copy-fields. The sheet is the launchpad and the workbench.

**Pros**

- Clean tiles; phone-friendly (tap is the universal touch gesture, no hover, no tiny buttons).
- One obvious place for _everything_ a card needs → mirrors mature kanban (Trello/Linear card modal).
- Edit + delete + status move + multiple copy targets all fit without crowding the column.

**Cons**

- Dispatch is **two gestures** (tap card → tap copy), not one.
- A power user dispatching many cards in a row taps more.

**Principle:** one canonical surface per card; keep the board scannable.

---

## Alternative C — Hybrid (lean tile + one quick-copy, full kit in the sheet)

Tile shows a **single** quick-dispatch control (one tap = copy the default target, e.g. the prompt) AND tapping the tile body opens the detail sheet for everything else (dropdown to switch copy target, edit, move, delete, copy-fields).

**Pros**

- Common case is **one tap** (quick-copy on the tile); rich case is the sheet. Best of A and B.
- Tile carries exactly one extra control, not a cluster → stays clean on phone.
- Degrades gracefully: the dropdown/choice lives in the sheet, so the tile button can be a plain, big, unambiguous "copy prompt."

**Cons**

- Two places can copy (tile quick-copy + sheet dropdown) — must keep their meaning consistent (tile = the default/prompt; sheet = choose).
- Slightly more design coordination between tile and sheet.

**Principle:** make the frequent path one tap _and_ keep the board clean, accepting a little duplication.

---

## Comparison

| Shape            | Taps to dispatch         | Tile cleanliness (phone) | Fits edit/move/delete | Matches mature kanban |
| ---------------- | ------------------------ | ------------------------ | --------------------- | --------------------- |
| A Tile-centric   | 1 (or 2 w/ dropdown)     | ✗ busy                   | awkward               | partial               |
| B Detail-centric | 2                        | ✓ clean                  | ✓ natural             | ✓ strong              |
| C Hybrid         | 1 (default) / 2 (choose) | ✓ clean (one control)    | ✓ in sheet            | ✓ strong              |

---

## Decision: **Alternative C — Hybrid**

**Reasoning.** The answers point both ways at once: _phone-first_ (argues for clean tiles → B) but the whole point is _frictionless dispatch_ (argues for tile copy → A). Hybrid resolves the tension:

- **Tile** = lean + a single big touch target "copy `/ai-kanban-work-card <id>`" quick action (the dropdown's default). One tap dispatches the common case.
- **Detail sheet** = the workbench: the copy **dropdown** (prompt vs raw id vs individual fields), richer fields, inline **edit** (title/description/priority), **manual status move**, **delete/archive**. This is where "match mature kanban" is delivered.

Rejected A (busy tiles fight phone touch + drag); rejected pure B (loses the one-tap dispatch the user explicitly wants). Keep A's and B's rejected notes here for backtracking.

**Open sub-decision carried to [Zoom 2](./30-zoom-2-anatomy.md):** does the tile quick-copy and the drag handle coexist cleanly on touch, or does the tile need an explicit drag handle vs tap-zones split? (Touch dnd + a tap-target button on the same tile is the main risk.)
