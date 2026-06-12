# Plan — Blocked Column + 2h Auto-Move + Board Auto-Refresh

> Adds a fifth board column **Blocked** with a time-based auto-move, quick
> actions to block / keep-blocked, and a `requestAnimationFrame`-driven board
> auto-refresh. High-level steps only — test scenarios are defined per step
> during implementation (one test at a time, meaningful-red gate).

## Decisions (locked)

- **Auto-move = persist-on-refresh (reconcile-on-read).** A blocked card stores
  `blockedUntil = now + 2h`. On every board data read (page load + the 5-min
  refresh), any Blocked card with `blockedUntil <= now` is moved to
  `need_review` with a real DB write (+ audit event), so the DB, board, and MCP
  all agree. (Trade-off: the move only fires when the board is read — acceptable
  and matches "persist on refresh".)
- **Buttons on both the tile and the detail sheet.** `Block` on active cards;
  `Still Blocked` (resets the 2h timer) on blocked cards.
- **Column order:** Todo · In Progress · **Blocked** · Need Review · Done.
  `Block` shows on Todo / In Progress / Need Review tiles; `Still Blocked` only
  on Blocked tiles. Blockable from any active card.
- **rAF refresh every 5 min**, honored as requested — pauses while the tab is
  hidden (frame loop checks accumulated elapsed time, then `router.refresh()`).
- **Transition policy:** unchanged. UI is already `any → any`, so `Blocked` is a
  legal UI target automatically. No new agent edge this slice.

---

## Step 1 — Data model: `Blocked` status + `blockedUntil`

**AC:** `Status` has `Blocked = "blocked"`. `CardDocument` /
`cardDocumentSchema` / client `Card` / `toClientCard` carry
`blockedUntil` (`Date | null` in the doc, ISO `string | null` on the client).
New cards default to `null`. **Legacy docs without the field still parse** (back-
compat, mirroring how `description` is handled) and read as `null`.

**Test type:** unit (schema + mapper).

**Depends on:** —

## Step 2 — Block / keep-blocked status writes

**AC:** Moving a card to `blocked` (UI caller) sets `blockedUntil = now + 2h`.
A `stillBlocked` operation on a blocked card resets `blockedUntil = now + 2h`.
Moving a card **out** of `blocked` clears `blockedUntil` back to `null`. Each
write emits the existing status-transition / audit event as today.

**Test type:** unit (service).

**Depends on:** Step 1.

## Step 3 — Reconcile overdue blocked cards on read

**AC:** A `reconcileBlockedCards()` operation moves every Blocked card with
`blockedUntil <= now` to `need_review` (atomic conditional update, clears
`blockedUntil`, emits the transition event), and is invoked on the board read
path so it runs on page load and on each refresh. A blocked card with a future
`blockedUntil` is left untouched. Idempotent under concurrent reads (no
double-move / duplicate events).

**Test type:** integration (service against the test Mongo).

**Depends on:** Steps 1–2.

## Step 4 — Board renders the Blocked column

**AC:** The board shows five columns in the order
Todo · In Progress · Blocked · Need Review · Done; blocked cards render under
Blocked with a live count badge. Drag-to-move into/out of Blocked works (UI
override).

**Test type:** unit (column grouping + board render).

**Depends on:** Step 1.

## Step 5 — Quick actions: `Block` and `Still Blocked` (tile + sheet)

**AC:** Active-card tiles (Todo / In Progress / Need Review) show a `Block`
action that moves the card to Blocked; Blocked tiles show a `Still Blocked`
action that resets the timer. The detail sheet offers the same two controls
(and `Blocked` is selectable in the status picker automatically). The sheet
shows the remaining time / auto-move hint for a blocked card. All actions are
server actions that `revalidatePath("/")`.

**Test type:** unit (component) + server-action tests.

**Depends on:** Steps 2 & 4.

## Step 6 — Board auto-refresh via `requestAnimationFrame` (5 min)

**AC:** A client `BoardAutoRefresh` component runs a rAF loop that accumulates
elapsed time and calls `router.refresh()` once ~5 minutes of **visible** time
has passed, then repeats. While the tab is hidden, rAF does not fire, so no
refresh occurs; it resumes on return. SSR-safe (client-only, guarded).

**Test type:** unit (mocked rAF + fake timers).

**Depends on:** — (logically lands after the column exists).

---

## Risks / watch-items

- **Schema back-compat:** legacy `cards` docs predate `blockedUntil`; the field
  must parse-as-null when absent (same pattern as `description`). Covered in
  Step 1's AC.
- **Write-during-render:** reconcile runs in the server read path. Keep it an
  atomic conditional update so two near-simultaneous reads can't double-move or
  double-audit (Step 3 AC).
- **Move only fires on read:** a card blocked and never viewed won't advance
  until the next board read. This is the accepted "persist on refresh" model.
- **rAF semantics:** unconventional for a 5-min cadence but intended — the
  hidden-tab pause is a feature, not a bug. Documented in Step 6.
- **MCP/agent:** unchanged this slice. `Blocked` is a UI/system concept; no new
  agent edge or MCP tool. Revisit if the agent ever needs to block/unblock.

## Out of scope

Configurable block duration, per-card custom timers, agent-driven blocking,
notifications, and search/filter (the separate review-loop slice).
