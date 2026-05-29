# Scheduler & Runner

> The orchestration loop — the novel core of the system. Pulls Todo cards, spawns local Claude Code (Remote Control) sessions per card, keeps them alive through review, recovers from crashes.
> Parent: [design README](./README.md) · contracts: [mcp-api-contract.md](./mcp-api-contract.md) · shapes: [data-model.md](./data-model.md)

---

## Decided shape

- **Reconcile loop**, not an event chain — each tick compares desired vs. actual state and converges (idempotent, missable, self-healing).
- **Periodic interval tick** (~15–30s). No change streams, no replica-set requirement.
- **One `claude remote-control` process per card**, `cwd` = that card's `workspaces/card-N/` — forced by the per-card multi-repo workspace. WIP enforced by us (claim count), not `--capacity`.
- **Crash recovery = auto-restart a fresh session** that resumes from the board task + the surviving worktree changes (chat transcript is lost; file changes persist).
- **Single process to start** (scheduler calls the runner as an in-process module). Splittable later.

---

## Two-axis state

Separate what the **human sees** from what the **supervisor manages**:

- **Board status** (kanban columns, user-facing): `todo → in_progress → need_review ↔ in_progress → done`
- **Run state** (lifecycle, supervisor-facing): `idle → starting → running → waiting → exited | failed`

| Board status | Typical run state | Meaning |
| ------------ | ----------------- | ------- |
| `todo` | `idle` | not picked up |
| `in_progress` | `starting` | claimed, process spawning, no session URL yet |
| `in_progress` | `running` | process up, agent working |
| `need_review` | `waiting` | process **alive**, agent paused for human (review or question) |
| `done` | `exited` | finished, process reaped, worktrees cleanable |
| (any in-flight) | `failed` | repeated start failures → circuit-broken, flagged for human |

Transient lifecycle never pollutes the columns; the board stays clean.

---

## The reconcile tick

```
tick():
  # 1. recurring intake (see below)
  for def in recurring_defs where enabled and due(def, now):
     items  = readSource(def.source)            # e.g. Notion
     picked = applySelectRule(def.selectRule, items)   # e.g. top-2 by priority
     for it in picked:
        try create_task(title, desc, priority, origin={recurring,def._id}, dedupeKey=it.id)
        catch ERR_DUPLICATE: skip               # already queued (partial unique index)
     def.lastRunAt = now

  # 2. reconcile in-flight cards (this IS crash recovery)
  for card in cards where status in {in_progress, need_review}:
     if card.runState in {starting, running, waiting} and not pidAlive(card.process):
        recover(card)                            # auto-restart fresh session

  # 3. pickup while there's headroom
  headroom = WIP_LIMIT - count(cards where status == in_progress)
  while headroom-- > 0:
     card = atomicClaim()                        # findOneAndUpdate todo→in_progress
     if not card: break
     runner.start(card)
```

Every step is idempotent — overlapping or missed ticks converge to the invariants.

---

## Recurring intake

A `recurring_def` is **due** when `now ≥ nextRunAt` (computed from its `schedule.cron`/`intervalMs` and `lastRunAt`, via a cron lib). On firing: read the source, apply `selectRule`, `create_task` each pick with a `dedupeKey` so the partial unique index prevents duplicate *open* cards. Notion reads can reuse the available Notion MCP/API. Source secrets resolved via env-ref (see data-model open questions).

---

## Atomic pickup

```ts
cards.findOneAndUpdate(
  { status: "todo", $or: [ {nextStartAfter: null}, {nextStartAfter: {$lte: now}} ] },
  { $set: { status: "in_progress", runState: "starting", pickedAt: now },
    $inc: { attempts: 1 }, $currentDate: { updatedAt: true } },
  { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" }
)
```

Single-doc atomicity guarantees no double-pickup even if a tick overlaps itself or a second scheduler runs.

---

## Runner lifecycle (per card)

```
start(card):
  ensure workspaces/card-<number>/ exists        # reused on restart; worktrees persist
  proc = spawn("claude", ["remote-control", "--spawn", "session",
               "--allowedTools", ALLOWED, "--name", `card-${card.number}`],
               { cwd: workspace, env: { CARD_ID: card._id, ...boardMcpEnv } })
  persist process = { pid: proc.pid, startedAt: now }
  url = scrapeStdout(proc, /https:\/\/claude\.ai\/code\/\S+/, timeout=T)   # Spike #1
  if !url:  kill(proc); onStartFailure(card); return
  set_session_url(card, { id: <sid>, url }); runState = "running"
  proc.on("exit", code => onProcessExit(card, code))
```

- The agent then drives itself via MCP: `get_my_task` → discover & confirm repos → `add_repo_to_my_workspace` → work → `set_my_status(need_review|done)`. The board **is** the task queue (no prompt injection — Spike #1). The bootstrap prompt is generic + the prohibition list; it gets its own doc.
- **Keep-alive:** the process stays up through `need_review` (that's how phone steering works). It is reaped only when the card reaches `done`.

```
onProcessExit(card, code):
  if card.status == "done":  runState = "exited"; scheduleCleanup(card)
  else:                      runState = "exited"   # dirty death → next tick's recover() restarts it
```

Recovery has a **single source of truth**: the reconcile loop's invariant #2. `onProcessExit` just records the exit; the next tick notices `status in-flight + pid dead` and restarts.

---

## Crash recovery (decided: auto-restart fresh)

```
recover(card):
  if startStorm(card):                 # safety circuit-breaker, see below
     runState = "failed"; lastError = {...}; return
  runState = "starting"
  runner.start(card)                   # reuses existing workspace + worktrees → agent resumes
```

- Worktree file changes survive a crash (they're on the `aikanban/card-N` branch on disk), so a fresh session **continues the work**; only the live chat transcript is lost.
- There is **no Remote-Control re-attach API** (Spike #1) — adopting the *old* session isn't possible, so we always spawn fresh.

**Circuit breaker (safety guard, not a policy change):** pure auto-restart could tight-loop if a card crashes *immediately on spawn* every time. Guard with exponential backoff via `nextStartAfter` and a high cap: after `MAX_RESTARTS` rapid failures, set `runState=failed` + `lastError` and surface it on the board. Normal "crashed after doing real work" always restarts.

---

## Process ownership & deployable shape

- **Start as one process**: the scheduler runs the tick on an interval and owns the runner module + child `claude` processes.
- **Spawn children detached** and persist their PIDs, so if the scheduler restarts, live sessions aren't killed — the next tick re-adopts them by PID (alive) or restarts them (dead). This makes keep-alive survive scheduler restarts.
- Splitting scheduler/runner into separate deployables later is possible; the contract between them is just the `cards` collection + PIDs.

---

## Data-model additions

These runtime fields on `cards` are managed solely by the scheduler/runner (added in [data-model.md](./data-model.md)):

`runState`, `process { pid, startedAt }`, `attempts`, `restarts`, `nextStartAfter`, `lastError { code, message, at }`.

---

## Open questions

1. **`scrapeStdout` timeout `T`** and exact URL format — pins on the Spike #1 hands-on test.
2. **Bootstrap prompt** content (generic resume-aware prompt + prohibition list) — see [bootstrap-prompt.md](./bootstrap-prompt.md).
3. **WIP_LIMIT** default (start at 1 per the brainstorm slice plan, raise once stable).
4. **Worktree cleanup timing** — on `done` immediately, or keep until the branch is merged/reviewed.
5. **Backoff curve / `MAX_RESTARTS`** values.
