# Zoom Layer 2 — Anatomy: Tile, Detail Sheet, Copy Dropdown

> Part of the [board-ux brainstorm](./00-problem-and-context.md). Builds on the [Hybrid decision](./20-zoom-1-launchpad-shape.md). Next: [Zoom 3 — implementation](./40-zoom-3-implementation.md).

Three pieces to lay out: the **tile** (scannable + 1-tap dispatch), the **detail sheet** (workbench), and the **copy dropdown** (what gets copied).

---

## 2.1 Resolve first: touch drag vs. tap targets on one tile

The tile must support **drag-to-move** (dnd-kit), **tap-to-open detail**, and a **tap quick-copy button** — all on touch, where there's no hover and a long-press can mean "drag." Conflict risk is real.

**Options**

1. _Whole tile draggable + buttons stopPropagation_ — fragile on touch; a tap on the button can start a drag.
2. _Explicit drag handle_ — a small grip zone (`⋮⋮`) is the only draggable region; the rest of the tile is tap-to-open; the copy button is its own tap target. **dnd-kit supports handle-scoped listeners.**
3. _Drag disabled on phone, move via detail sheet_ — simplest, but throws away drag where it's nice on desktop.

**Decision: Option 2 — explicit drag handle.** Touch-first needs unambiguous zones: **grip = drag**, **body = open detail**, **copy button = copy**. This also fixes a latent issue — today the _entire_ tile is the drag listener, so any future tap target is ambiguous. dnd-kit `listeners` move from the tile root onto the handle only.

```
┌──────────────────────────────┐
│ ⋮⋮  #12   P0            ⧉    │  ⋮⋮ = drag handle, ⧉ = quick-copy prompt
│ Title of the task            │  ← tap this body region = open detail sheet
│ short description preview…    │
│ repo·branch  · 2h ago        │
└──────────────────────────────┘
```

---

## 2.2 Tile anatomy (lean, scannable)

Grows from "#number / P / title" to a triage-grade tile, still calm:

| Slot                | Source field           | Notes                                                          |
| ------------------- | ---------------------- | -------------------------------------------------------------- |
| Drag handle `⋮⋮`    | —                      | only draggable zone (2.1)                                      |
| Number `#12`        | `number`               |                                                                |
| Priority `P0`       | `priority`             | keep the existing badge                                        |
| Quick-copy `⧉`      | `id`                   | one tap → `/ai-kanban-work-card <id>`; brief "Copied" feedback |
| Title               | `title`                |                                                                |
| Description preview | `description`          | 1–2 lines, truncated; omit if empty                            |
| Repo/branch chip    | `repos[0]`             | e.g. `repo·branch`; "+N" if multiple; omit if none             |
| Age / timestamp     | `createdAt`/`pickedAt` | relative ("2h ago"); which timestamp depends on column         |
| Origin marker       | `origin.type`          | subtle icon only if `recurring`                                |

**Cleanliness rule:** description, repo chip, and origin marker are **conditional** — an empty Todo card still looks like today's calm tile. Match mature kanban density (Linear-ish), not a wall of metadata.

---

## 2.3 Detail sheet anatomy (the workbench)

Opened by tapping the tile body; **URL-driven** (`?card=<id>`, per web-ui.md + url-state rule) so it's deep-linkable and survives refresh/polling. On phone this is a **bottom sheet / full-height drawer** (shadcn `Sheet` or `Drawer`); on desktop a right-side drawer.

**Regions (top → bottom):**

1. **Header** — `#number` · title (tap to edit) · priority · status pill.
2. **Dispatch block (primary, top, thumb-reachable)** — big **Copy split-button**: main button copies the default (prompt); the **dropdown** chooses the copy target (see 2.4). This is the launchpad's heart.
3. **Fields (read/edit)** —
   - **Title** (edit), **Description** (edit, multiline), **Priority** (edit, select/stepper).
   - **Status** — current + **manual move** controls (segmented buttons for the 4 columns; the phone-friendly drag alternative).
   - **Repos[]** — list of `repo · branch · worktreePath`, each with a **copy-field** icon.
   - **Timestamps** — created / picked / finished, humanized.
   - **Origin** — manual/recurring.
   - **Future slot** (marked) — `runState` badge / `session_url` link / `lastError`, shown only when present; clearly "coming later," never faked.
4. **Danger zone** — **Delete / archive** with a confirm dialog.

**Edit interaction:** inline edit (tap field → input appears) with explicit **Save** (Server Action) + optimistic update; Esc/cancel reverts. Avoid auto-save ambiguity on touch.

---

## 2.4 Copy dropdown mechanics

The dropdown is the "what lands on the clipboard" chooser. shadcn `DropdownMenu` paired with the copy button (a split-button: press = default, caret = menu).

| Menu item                                       | Clipboard payload                          |
| ----------------------------------------------- | ------------------------------------------ |
| **Copy dispatch prompt** (default)              | `/ai-kanban-work-card <id>`                |
| **Copy card id**                                | `<id>` (24-hex)                            |
| **Copy id + title** _(maybe)_                   | `<id>  — <title>` for human-readable paste |
| (in field rows) **Copy worktree path / branch** | the raw field value                        |

**Behaviors:**

- Clipboard via the browser **Clipboard API** in a small client helper; fallback note for non-secure contexts (Remote Control should be https).
- **Feedback**: transient "Copied ✓" (toast or inline label swap) — essential on phone where there's no cursor.
- **Default memory** (optional, later): remember the last-chosen target so the tile quick-copy matches the user's habit. Defer — start with prompt as the fixed default.

---

## Anatomy summary

- **Tile** = grip + scannable metadata + one quick-copy. Clean, conditional fields.
- **Sheet** = dispatch-first workbench: copy dropdown, edit fields, status move, copy-fields, delete. URL-driven, phone bottom-sheet.
- **Dropdown** = prompt (default) / raw id / field values, with copied-feedback.

Carry to [Zoom 3](./40-zoom-3-implementation.md): component/file breakdown, which Server Actions are new, what (if any) backend work delete/archive needs, and the test slices.
