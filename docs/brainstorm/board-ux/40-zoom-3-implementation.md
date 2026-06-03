# Zoom Layer 3 — Implementation Shape & Build Slices

> Part of the [board-ux brainstorm](./00-problem-and-context.md). Realizes the [Hybrid shape](./20-zoom-1-launchpad-shape.md) + [anatomy](./30-zoom-2-anatomy.md) against the current code. This is design-level, not code — TDD writes the tests.

---

## 3.1 What exists vs. what's new

**Backend today** (`src/cards/card.service.ts`): `createTask`, `getTask`, `listTasks`, `updateTaskStatus`. **Actions** (`app/(board)/actions.ts`): `createTaskAction`, `moveCard`.

| Capability                          | Backend status                     | New work                                            |
| ----------------------------------- | ---------------------------------- | --------------------------------------------------- |
| Read fields for tile/sheet          | ✅ `Card` already carries them     | none (data already on the board)                    |
| Copy prompt / id / field            | n/a (pure client)                  | client clipboard helper                             |
| Manual status move (sheet)          | ✅ `updateTaskStatus` / `moveCard` | reuse existing action                               |
| **Edit title/description/priority** | ❌ no `updateTask`                 | new `updateTask` service + `updateTaskAction` + Zod |
| **Delete / archive**                | ❌ none                            | new service + action (+ decide delete vs archive)   |

---

## 3.2 Delete vs. archive (sub-decision)

- **Hard delete** — `deleteOne` + a `card_events` audit entry. Simple; irreversible. Fits a single-user board.
- **Soft archive** — add `archived: boolean` (or a 5th `Status.Archived`) and filter it out of `listTasks`. Reversible; more surface (filter, an "archived" view).

**Lean recommendation:** start with **hard delete + confirm dialog + `card_events` audit** (cheapest, matches single-user reality). Note soft-archive as a future layer if you later want undo. _Confirm this when planning._

---

## 3.3 Component / file breakdown (follows file-structure rule)

All under `app/(board)/`. Each file < 300 lines; `*.ui.tsx` = display, `*.state.tsx` = client state/hooks, `*.tsx` = server compose.

**Tile (extend existing):**

- `card.ui.tsx` — grow tile per [2.2](./30-zoom-2-anatomy.md#22-tile-anatomy-lean-scannable): conditional description/repo/age/origin slots.
- `draggable-card.ui.tsx` — move dnd `listeners` onto an explicit **drag handle** ([2.1](./30-zoom-2-anatomy.md#21-resolve-first-touch-drag-vs-tap-targets-on-one-tile)); tile body becomes the open-detail tap zone.
- `copy-dispatch.ui.tsx` + `copy-dispatch.state.tsx` (new) — the split-button + dropdown + clipboard helper + "Copied" feedback. Reused on tile (quick-copy) and sheet (full dropdown).

**Detail sheet (new):**

- `card-detail.tsx` (server) — reads `?card=<id>` from `searchParams`, composes the sheet from the card already in scope (or `getTask`).
- `card-detail.ui.tsx` — sheet layout regions ([2.3](./30-zoom-2-anatomy.md#23-detail-sheet-anatomy-the-workbench)) using shadcn `Sheet`/`Drawer`.
- `card-detail.state.tsx` — open/close synced to URL (`router.replace('?card=…')`), inline-edit field state, save/cancel.
- `href.ts` — extend with `cardDetailHref(id)` / `closeDetailHref()` factories.

**Actions / backend (new):**

- `card.service.ts` — add `updateTask(id, patch)` and `deleteTask(id)` (or `archiveTask`).
- `card.schema.ts` — add `updateTaskInputSchema` (title/description/priority, all optional, validated).
- `actions.ts` — add `updateTaskAction`, `deleteTaskAction`; both `revalidatePath('/')`.

**shadcn components likely needed:** `Sheet` (or `Drawer`), `DropdownMenu`, `AlertDialog` (delete confirm), `Textarea`, `Select`. Install via `npx shadcn add …`.

---

## 3.4 Build slices (incremental, test-first)

Ordered so each slice ships value and is independently testable. One BDD scenario (outer) per slice; TDD (inner) for service/helpers.

1. **Slice A — Copy-to-dispatch (the core gap).**
   - Clipboard helper + `copy-dispatch` control on the **tile** (quick-copy `/ai-kanban-work-card <id>`) and a dropdown (prompt vs raw id).
   - _Test:_ clicking copy puts the right string on the clipboard; dropdown switches payload. Pure client/unit — highest value, zero backend.

2. **Slice B — Drag-handle refactor.**
   - Move dnd listeners to an explicit handle; tile body free for tap-to-open. _Test:_ drag still moves; body tap doesn't drag.

3. **Slice C — Card detail sheet (read-only) + URL state.**
   - `?card=<id>` opens a sheet showing all fields + repos + timestamps + the copy dropdown + copy-field icons.
   - _Test:_ URL param opens sheet with correct card; copy-field copies raw value.

4. **Slice D — Manual status move from the sheet.**
   - Segmented status controls calling existing `moveCard`. _Test:_ moving from sheet updates status + revalidates.

5. **Slice E — Edit core fields.**
   - `updateTask` service (TDD) → `updateTaskAction` → inline edit in sheet. _Test:_ service patches only provided fields + bumps `updatedAt`; action validates; UI saves optimistically.

6. **Slice F — Delete / archive.**
   - `deleteTask` (or archive) service (TDD) + confirm dialog + action. _Test:_ deletes card + writes audit event; board no longer lists it.

7. **Slice G — Tile enrichment polish.**
   - Conditional description/repo/age/origin slots; mobile density pass. _Test:_ empty card stays calm; populated card shows chips.

**Dependency notes:** A is standalone (do first). B unblocks C's tap-to-open. C unblocks D/E/F (they live in the sheet). G is independent polish, can land anytime.

---

## 3.5 Risks & mitigations

- **Touch dnd vs taps** → explicit drag handle (Slice B before C).
- **Clipboard API on Remote Control** → ensure https context; provide a visible fallback (select-to-copy) if `navigator.clipboard` is unavailable.
- **Sheet vs polling** → sheet reads URL-addressed card; board `Poller` (when added) must not yank the open card. Inherit board refresh for v1; self-poll is a later option (web-ui.md open Q4).
- **Scope creep on fields** → "clean over complete" gate ([principle 4](./10-clarifying-questions.md#derived-design-principles)); future-only fields stay clearly marked, never half-built.

---

## 3.6 What this does NOT do (keep the board thin)

No diff viewer, comments, or transcript — those stay in claude.ai. No scheduler/runner work. No recurring-definition UI. `runState`/`session_url`/`lastError` remain future-marked slots unless cheap to populate.

---

## Next step

This brainstorm is ready to graduate to a real plan. Recommended: run `@create-implementation-plan` (or the orchestrated workflow) over **Slice A first** (copy-to-dispatch — the actual pain), then B→C→… Update [web-ui.md](../../design/web-ui.md) to reflect the copy-dispatch reframing once a slice lands.
