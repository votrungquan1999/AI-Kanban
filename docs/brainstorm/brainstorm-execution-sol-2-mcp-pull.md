> Candidate #2 for [brainstorm-execution-billing.md](./brainstorm-execution-billing.md). Sibling candidates: sol-1 (tmux-pool), sol-3 (pty-per-card), sol-4 (remote-control).

# Candidate #2 — MCP pull-loop: self-driving interactive sessions

**One-line shape.** Don't push tasks into sessions; let the sessions **pull**. Start ~5 genuinely-interactive `claude` sessions **once, by hand**, give each a self-driving loop prompt, and have the SESSION call a new queue-level MCP tool `claim_next_task` to grab its own card, work it, mark it `need_review`/`done`, then loop and claim the next. No keystroke injection ever — the only thing crossing the process boundary is a tool call the agent itself decides to make. This answers the billing constraint by removing the one fragile thing in the other candidates: **there is no external driver feeding the session.** Each session is started interactively (human types the bootstrap once) and thereafter only talks out via MCP tool calls — normal interactive Claude behavior.

---

## Topology — the ~5 sessions

```
 ┌─ user's Mac (awake to run) ───────────────────────────────────┐      ┌ cloud ┐
 │  caffeinate -is                                                │      │       │
 │   ├─ session W1  (claude, interactive, /loop prompt) ─┐        │      │ Atlas │◄ board
 │   ├─ session W2  ...                                  │ MCP    │      │  M0   │   ▲ phone
 │   ├─ session W3  ...                                  ├──────► board ─┤       │───┘
 │   ├─ session W4  ...                                  │ (HTTP) MCP svr │       │
 │   └─ session W5  ...                                  ┘        │      └───────┘
 │   thin supervisor: keep 5 alive + refill queue                │
 └────────────────────────────────────────────────────────────────┘
```

- **Launch once, interactively.** Each worker is a real `claude` in a TTY (a tmux window or a launchd-spawned login shell the user attaches to once to authenticate). The human triggers the loop bootstrap (below) a single time per worker; after that it self-feeds. This keeps it "interactive by nature": the same artifact you'd run by hand.
- **Kept alive by the loop itself.** The worker never ends its turn except to pause for review or idle on empty queue; between cards it loops back to `claim_next_task` rather than exiting. The process only dies on crash/sleep, which the supervisor restarts.
- **Generic, card-agnostic.** A worker is NOT born owning a `CARD_ID`; it owns nothing until it claims. CARD_ID becomes a value the worker *holds in context* for one iteration, returned by `claim_next_task`, not an env var baked at spawn.

### The loop / bootstrap prompt

Built on `/loop` (or an explicit self-prompt tail; see [bootstrap-prompt](../design/bootstrap-prompt.md)). `/loop` with no interval lets the model self-pace — perfect: it re-runs the body each time the agent ends a turn, so "claim → work → finish → loop" needs no timer.

```text
You are a long-lived worker in an AI-Kanban pool. Process cards one at a time, pulling
your own work. Repeat forever:
§0 RESET — Run /clear; you hold no card and start fresh.
§1 CLAIM — Call claim_next_task(). If null (empty queue), say "idle" and STOP your turn;
   the loop re-invokes you to retry. Else it returns { cardId, number, title,
   description, parentDir, workspacePath }. Remember cardId for THIS iteration only.
§2 SET UP — Ensure workspacePath exists; scan parentDir; propose repos and pause
   (set_my_status(cardId,"need_review")); on resume add_repo_to_my_workspace(cardId,repo)
   each. Edit only inside these worktrees, branch aikanban/card-<number>.
§3 WORK — Do the task; commit as you progress; obey the prohibitions.
§4 FINISH — done & confident → set_my_status(cardId,"done"). Need a human →
   set_my_status(cardId,"need_review"), STOP, wait; on reply resume.
§5 LOOP — card fully done → go to §0.
```

The key difference from today's prompt: an explicit **§0 RESET** and **§1 CLAIM**, and every tool call now carries the `cardId` the agent is holding (or the server infers it from the worker's lease — see below).

---

## MCP changes — card-scoped → queue-level

Today the agent gets `get_my_task / set_my_status / add_repo_to_my_workspace`, all implicitly bound to an injected `CARD_ID` (see [mcp-api-contract](../design/mcp-api-contract.md#agent-scoping-least-privilege)). The pull model removes the injected CARD_ID and adds **one** queue-level tool.

| Tool | Pull model | Notes |
| ---- | ---------- | ----- |
| `claim_next_task()` | **NEW** — atomic `todo → in_progress` claim, returns the card + workspace info | replaces scheduler-side pickup; this is the only genuinely new surface |
| `set_my_status(cardId, status)` | now takes an explicit `cardId` | the worker holds it from the claim |
| `add_repo_to_my_workspace(cardId, repo)` | now takes explicit `cardId` | same body as today |
| `get_my_task(cardId)` | optional re-read (e.g. after `/clear` mid-iteration) | |

### Replacing CARD_ID injection — the worker-lease

Least-privilege scoping (today: "reject if `id !== CARD_ID`") still matters — we don't want worker W2 to move W1's card. We replace the env-var binding with a **per-worker lease** recorded server-side at claim time:

- Each worker process is started with a stable `WORKER_ID` env var (e.g. `w1..w5`) — the one piece of per-process identity that survives. The board MCP connection is tagged with it.
- `claim_next_task()` stamps the claimed card with `claimedBy: WORKER_ID`.
- `set_my_status` / `add_repo_to_my_workspace` accept a `cardId` but the server **verifies `card.claimedBy === WORKER_ID`**, else `ERR_FORBIDDEN`. So a worker can only ever touch the card it currently leases. CARD_ID-injection scoping becomes lease-verification scoping — same guarantee, derived at runtime.

Minimal contract change: one new tool, two existing tools gain an explicit id argument, scoping moves from env to lease.

---

## Claim mechanism — atomic claim INSIDE the tool

The atomic pickup that today lives in the scheduler tick ([scheduler-runner](../design/scheduler-runner.md#atomic-pickup)) moves **server-side into `claim_next_task`**. Because two pool workers may call it concurrently, the single `findOneAndUpdate` is exactly the mutual-exclusion mechanism — Mongo single-doc atomicity guarantees the two callers select disjoint cards.

```ts
// inside claim_next_task(workerId), server-side:
const now = new Date();
const card = await cards.findOneAndUpdate(
  { status: "todo",
    $or: [{ nextStartAfter: null }, { nextStartAfter: { $lte: now } }] },
  { $set: { status: "in_progress", runState: "running",
            claimedBy: workerId, pickedAt: now },
    $inc: { attempts: 1 },
    $currentDate: { updatedAt: true } },
  { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" }
);
if (!card) return null;                 // queue empty → worker idles
// ensure workspacePath, return the slice the worker needs:
return { cardId: card._id.toString(), number: card.number, title: card.title,
         description: card.description, parentDir: PARENT_DIR,
         workspacePath: card.workspacePath };
```

- **WIP limit becomes implicit.** With exactly 5 workers each holding ≤1 card, WIP is structurally capped at the pool size — no separate `WIP_LIMIT` count is needed (the pool *is* the limit). A worker that finishes claims again; if the queue is empty it idles.
- Two workers calling concurrently → each `findOneAndUpdate` matches a different `todo` doc (or none); they never collide. Same guarantee the scheduler relied on, invoked from N agents instead of one tick.

---

## Context hygiene — the trickiest part, addressed honestly

A reused long-lived session is the whole risk surface: card N+1 must NOT inherit card N's reasoning, file mental-model, or half-finished plans. Options, with honest verdicts:

1. **`/clear` between iterations (§0).** Built-in, resets the conversation transcript to empty while keeping the *same process and the same subscription session*. This is the primary mechanism and the reason §0 exists. **Risk:** `/clear` is a slash command normally typed by a human; whether a `/loop`-driven body can reliably issue it as its first action, and whether it fully clears (vs. compacts), needs the hands-on spike. If `/clear` can't be self-issued, the loop body itself must avoid referencing prior cards and rely on the model's turn boundary — weaker, and the real worry.
2. **Fresh subtask per card (Task/subagent).** The loop spawns a clean subagent to do the card work, so each card gets a pristine context window; the parent loop only holds claim/dispatch state. **Cleaner isolation than `/clear`,** but a subagent may bill/behave differently and adds a layer — verify it stays interactive-billed.
3. **Accept bounded leakage + periodic recycle.** `/clear` each iteration AND have the supervisor **recycle each worker every K cards** (kill + relaunch) so context can't accumulate unboundedly over long uptime. Cheap safety net regardless of (1)/(2).

**Recommendation:** primary = `/clear` (1), safety net = periodic recycle (3), fallback = subtask (2) if the spike shows `/clear` unreliable. The single biggest open question.

---

## Worktree isolation

Same shape as today, but the worker (not a runner) drives setup. `claim_next_task` returns `workspacePath` (`workspaces/card-<number>/`); the worker ensures it exists, then per confirmed repo calls `add_repo_to_my_workspace`, whose server side runs `git worktree add ... -b aikanban/card-<number>`. Because each worker holds exactly one card at a time, worktree dirs never overlap across workers — isolation is per-card, identical to today. On `/clear`+next-claim the previous card's worktree is left on disk for review/cleanup (unchanged policy).

---

## Completion / handoff — the clean win

The worker calls `set_my_status(cardId, "need_review"|"done")`. **The board/supervisor never parses session output to learn the outcome** — it just reads Mongo. This is a material advantage over push/scrape candidates: today's design has to `scrapeStdout` for a session URL and infer state; here state transitions are first-class tool calls, already audited via `card_events` ([data-model](../design/data-model.md#card_events-implemented)). No fragile regex, no "did it finish or hang?" ambiguity. The card moving to `need_review`/`done` IS the handoff signal.

---

## Per-card phone reviewability — the story takes a hit

This is the cost of reuse. One worker = **one long claude.ai session URL** spanning many cards in sequence. The current keystone — *each card individually reviewable on the phone via its own Remote Control link* — does **not** survive cleanly: there's no 1:1 card↔session URL anymore. Mitigations:

- **Per-card audit timeline from `card_events`** (already implemented) becomes the primary review surface: every claim/transition/repo-add is queryable by `cardId`, rendered as the card-detail timeline ([next-actions](../design/next-actions.md)). Review moves from "scrub the chat" to "read the timeline + the worktree diff."
- **Session bookmarks / anchors.** On claim, store the worker's session URL + a turn-anchor on the card; the phone link becomes `<session URL>#<anchor>` — best-effort deep link. Fidelity depends on Remote Control anchor support (spike).
- **The worktree diff is the source of truth** for "what did it do," independent of chat.

Honest verdict: **per-card phone review degrades from "tap the card's own session" to "read the card's timeline + diff, optionally deep-link into a shared transcript."** If strict 1:1 phone review is non-negotiable, candidates #3/#4 serve it better; this candidate trades it for billing-robustness and dispatch simplicity.

---

## What still needs a runner at all?

Almost nothing of the old runner survives — that's the point. The reconcile-loop's pickup (invariant #3) **moves into `claim_next_task`**; per-card spawn/scrape disappears. The minimal supervisor reduces to two jobs:

1. **Keep N workers alive** — health-check the 5 processes; relaunch any that died, re-running the loop bootstrap; plus periodic recycle for context hygiene (above).
2. **Refill the queue** — the recurring intake (Notion → `create_task`) from [scheduler-runner](../design/scheduler-runner.md#recurring-intake) still runs; workers only pull from `todo`, so something must keep `todo` stocked.

**Crash recovery changes shape.** A dead worker may leave a card stuck `in_progress` with `claimedBy: wX`. The supervisor finds `in_progress` cards whose `claimedBy` worker is dead → resets to `todo` so another worker re-claims. Worktree changes persist on the branch (same as today), so the re-claiming worker continues, not restarts-from-zero. This replaces per-card pid-tracking with per-worker liveness + a stale-lease sweep.

---

## Crash / restart / sleep / auth

- **Worker crash** → stale-lease sweep (above) frees the card; supervisor relaunches the worker; loop resumes from §0 and re-claims fresh work. The dead worker's in-flight card is recovered by lease-reclaim, not by adopting its (lost) transcript.
- **Machine sleep** → `caffeinate -is` keeps it awake while running (from [research](../research/README.md)); on wake the supervisor health-check relaunches any OS-killed worker; mid-flight cards get lease-swept.
- **Auth.** Subscription OAuth must be present and `ANTHROPIC_API_KEY` **unset** (a key routes to metered billing, defeating the premise). Workers run as interactive `claude` under the user's cached OAuth (`claude /login` once). Because the human starts each worker interactively at least once, the browser OAuth flow is natural — *easier* than a headless daemon. Supervisor relaunches into the same authenticated login shell, never injecting an API key.

---

## Tradeoffs / principles / priorities

- **Principle: pull beats push.** Removing the injection channel removes the single most billing-fragile, most spike-dependent mechanism in the other candidates. The session drives itself the way a human-attended session would.
- **Priority order:** billing-safety > dispatch simplicity > per-card reviewability. This candidate optimizes the first two and explicitly sacrifices some of the third.
- **Simplicity win:** state lives in Mongo + tool calls, not in scraped stdout. The supervisor shrinks to "keep 5 alive + refill queue."
- **Cost:** the reused-session model makes context hygiene and per-card review the hard problems — inherent, not incidental.

## Assumptions to verify (spikes)

1. **`/loop` (or a self-prompt tail) can sustain a claim→work→finish→loop cycle** in an interactive session without a human, and re-invokes on idle without burning tokens spinning. **Load-bearing.**
2. **`/clear` can be self-issued by the loop body and actually resets context** (not just compacts). If false → fall back to per-card subtask. **Biggest risk.**
3. **A long interactive session that idles (queue empty) then resumes still bills to the subscription** and isn't reclassified. (Billing agent confirms; design assumes yes.)
4. **MCP over the long-lived session** supports a queue-level tool the agent calls repeatedly across `/clear` boundaries (the MCP connection survives `/clear`).
5. **Remote Control anchors/bookmarks** exist for the per-card deep-link mitigation (else fall back to timeline+diff only).

## Failure modes

- **Context bleed** card N→N+1 if `/clear` underperforms → wrong-repo edits, stale plans. Mitigated by recycle + subtask fallback.
- **Stuck lease** if a worker hangs (not crashes) holding a card → card never moves. Need a **lease TTL**: `claimedBy` + `claimedAt`; sweep `in_progress` cards with no transition for T minutes back to `todo`.
- **Thundering claim on empty queue** — 5 idle workers polling → wasteful turns. Back off via `/loop` interval-on-idle when `claim_next_task` returns null.
- **Silent API-key billing** if `ANTHROPIC_API_KEY` leaks into the env → drains the metered pool invisibly. Guard: supervisor asserts the key is unset before launch.
- **Non-deterministic claim order** across workers — acceptable; priority/FIFO sort is still honored within each claim.

---

## Verdict (1–5 stars)

| Dimension | Stars | Why |
| --------- | ----- | --- |
| Autonomy | ★★★★★ | self-driving; no injection, no per-card spawn; refills + recovers via Mongo |
| Billing-safety | ★★★★☆ | genuinely-interactive, no SDK/headless path, no API key; −1 for the unverified "idle interactive session stays subscription-billed" assumption |
| Robustness | ★★★☆☆ | clean Mongo-based handoff & recovery, but context hygiene + stuck-lease detection are real, unproven risks |
| Build-effort | ★★★★☆ | small: one new MCP tool + lease scoping + a thin keep-alive/refill supervisor; most of the old runner is deleted, not added |
