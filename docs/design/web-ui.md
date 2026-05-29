# Web UI

> The thin human surface: **intake** (add tasks) + **monitor/launchpad** (see the 4 columns, jump into a card's `claude.ai` session). Deep review lives in claude.ai, not here. Mobile-first. **v1 scope: board + one-time tasks** (recurring-definition management is a later doc).
> Parent: [design README](./README.md) · reads/writes via [mcp-api-contract](./mcp-api-contract.md) service layer · card shape in [data-model](./data-model.md)

---

## Decided shape

- **Next.js App Router.** Server Components **read** via the in-process core service (no separate API for the UI); **Server Actions write** (`createTask`, `moveCard`).
- **Polling** keeps the board current (cards change from agents/scheduler outside the browser).
- **Mobile-first** — you triage Need Review and open sessions from your phone.

## What the board is NOT

No diff viewer, no comments, no transcript. Those are claude.ai's job. A `need_review` card just shows a **button into its `session_url`**. Keep the board thin (the "board can be VERY thin" insight from the architecture doc).

---

## Data flow

```
page.tsx (Server Component)
  ├─ await searchParams        → which card drawer / dialog is open (URL state)
  ├─ service.listTasks()       → cards grouped by status   (RSC data fetch)
  └─ renders <Board …> (client) with server data as props
        │  user drags a card / submits add-task
        ▼
  Server Action (actions.ts)  → service.updateTaskStatus | service.createTask
        │  revalidatePath('/')
        ▼
  RSC re-renders with fresh data
```

- **Reads** happen in the Server Component that uses them (per server-components-rules §4). DB/service access stays server-side.
- **Writes** are Server Actions calling the same service functions the scheduler/UI share — UI uses the **human "any→any" override** in the [transition policy](./mcp-api-contract.md#status-transition-policy).
- **No client-side data fetching** in Server Components; interactivity is isolated in small `'use client'` components that receive server data as props.

---

## Polling

A tiny client `Poller` component runs `setInterval(() => router.refresh(), N)` (N ≈ 3–5s). `router.refresh()` re-runs the Server Components and pulls fresh card data without losing client state. Pause polling while a drag is in progress so a refresh can't yank a card mid-drag; reconcile via `revalidatePath` after the drop.

---

## URL state (per url-state-management rule)

Drawer/dialog open-state lives in the **URL**, handled **server-side** and passed to client components as initial state:

| Param | Meaning |
| ----- | ------- |
| `?card=<id>` | card detail drawer open for that card |
| `?new=task` | "add one-time task" dialog open |

`page.tsx` reads `searchParams`, converts to typed state, and passes it down. Client components sync back with `router.replace('?card=…', { scroll: false })`. Hrefs come from an `href.ts` factory colocated with the board (server-components-rules §3).

---

## Components & responsibilities

Display components are `*.ui.tsx` (pure, `children`-driven, no data fetching — server-components-rules §2/§5); interactivity is isolated in client wrappers.

| Component | Kind | Responsibility |
| --------- | ---- | -------------- |
| `page.tsx` | Server | read searchParams, fetch grouped cards, compose |
| `Board` | Client | the 4 columns + dnd context (drag-to-move) |
| `Column.ui` / `Card.ui` | Display | layout + card content (title, priority, badges) |
| `Poller` | Client | interval `router.refresh()` |
| `CardDrawer` | Client | detail drawer (open from `?card=`) |
| `AddTaskDialog` + form | Client | one-time task form → `createTask` action |

### Card (board tile)

Shows: title, priority, and **status signals** — a `runState` badge, a "🔗 session" indicator when `session_url` is set, and a **distinct `failed` style** (so a circuit-broken card is obvious). `need_review` column is visually emphasized (it's your WIP queue).

### Card detail drawer

Read-only context + a couple of actions:

- **Content:** description, confirmed `repos[]` (repo · branch), timestamps, `runState`, and `lastError` (message) if present.
- **Primary action:** **Open session** → `session_url` (opens claude.ai in a new tab / the mobile app). This is the path to actual review.
- **Secondary:** manual status move (the drag alternative for phone), and — for a `failed` card — a **Retry** action (clears the backoff gate so the reconciler restarts it).

### Add one-time task

Form fields → `createTask({ title, description?, priority?, origin: { type: "manual" } })`. Validated with the **shared Zod schema** from the data layer (one source of truth, client + server). On success, `revalidatePath('/')` and close the dialog.

---

## Drag-to-move

`Board` is a client component using a dnd lib (e.g. dnd-kit). On drop:

1. `useOptimistic` moves the card immediately (snappy on touch).
2. Call `moveCard(id, toStatus)` Server Action → `service.updateTaskStatus` (human override allows any column).
3. `revalidatePath('/')` reconciles; if the action errors, the optimistic state reverts and a toast shows why.

---

## Mobile-first layout

- Columns are horizontally scrollable / snap on small screens; tap a card → drawer (drawer is easier than drag on a phone, so the drawer's manual-move is the primary phone interaction).
- Touch-friendly hit targets; the **Open session** button is prominent on `need_review` cards.
- Styling: Tailwind (per tailwind-basics rule), layout in `*.ui.tsx`.

---

## Out of scope (v1)

- **Recurring-definition management UI** — its own doc / build slice.
- **Auth** — single-user, local; no login in v1.
- **SSE/live push** — polling is enough; revisit only if lag is annoying.

---

## Open questions

1. **Polling interval `N`** and whether to back off when the tab is hidden (`visibilitychange`).
2. **dnd library** choice (dnd-kit vs. a lighter touch-first option) — decide at implementation.
3. **Retry UX** — is clearing the backoff gate enough, or does a failed card also need a one-tap "send back to Todo"?
4. Whether the drawer should **poll its own card** (faster updates while you're watching one card) vs. rely on the board-level `Poller`.
