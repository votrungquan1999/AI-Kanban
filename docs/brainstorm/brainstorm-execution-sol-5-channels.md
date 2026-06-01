> Candidate #5 for [brainstorm-execution-billing.md](./brainstorm-execution-billing.md). Foundation: [prior-art](./brainstorm-execution-prior-art.md). Sibling candidates: sol-1 (tmux-pool), sol-2 (mcp-pull), sol-3 (pty-per-card), sol-4 (remote-control).

# Candidate #5 — Channels webhook into a live interactive session

**The idea.** Keep a pool of ~5 genuinely-interactive `claude` sessions, each **started once by the user** (interactive, claude.ai subscription auth), each running **with a custom webhook Channel attached**. The runner dispatches a card by **POSTing a task to the chosen worker's local channel HTTP port** — the message arrives inside the live session as a `<channel>` event, and Claude reacts and works the card. This is the prior-art's "one sanctioned way to push a message into a live interactive session" ([prior-art §6](./brainstorm-execution-prior-art.md)).

---

## Channels — verified facts (research preview, v2.1.80+)

From official docs ([channels](https://code.claude.com/docs/en/channels), [channels-reference](https://code.claude.com/docs/en/channels-reference)). **[DOC]** = documented; **[ASSUMED]** = inference.

- **[DOC] A channel is a *local* MCP server, NOT a remote endpoint.** Claude Code spawns it as a **subprocess over stdio**. The "webhook" is a **local HTTP port your channel server opens** (e.g. `127.0.0.1:8788`); external systems `POST` to that port and the server forwards the body via `mcp.notification({ method: 'notifications/claude/channel' })`. There is **no Anthropic-hosted webhook URL** Claude subscribes to — we host the receiver.
- **[DOC] The session auto-acts on an inbound message.** Docs: *"the message arrives … Claude reads it, does the work, and calls … `reply`."* No human ack is required to make Claude start working. **This is the load-bearing autonomy fact.**
- **[DOC] Events only arrive while the session is open** → "run Claude in a background process or persistent terminal." Fits a persistent worker pool.
- **[DOC] Two-way:** a channel can expose a `reply` tool so Claude posts back over the same channel (completion handoff). One-way (alerts only) is also supported.
- **[DOC] Delivery is fire-and-forget:** `notifications/claude/channel` is **not acknowledged** — `await` resolves on write-to-transport, not on Claude processing; dropped silently if the session didn't load the channel. For confirmation, track state + reply tool.
- **[DOC] Events queue + batch.** Notifications arriving while Claude is busy are "delivered together on the next turn and handled as a group" → **one card per session**; "to process independent event streams concurrently, run separate sessions." Validates the pool exactly.
- **[DOC] Auth: claude.ai *or* a Console API key** both work. **Billing class is NOT stated.** This is the residual uncertainty (see [Billing-safety](#billing-safety)).
- **[DOC] Permission prompts stall the session** when away unless launched with `--dangerously-skip-permissions` or the channel declares **permission relay** (`claude/channel/permission`) to forward yes/no to the phone.
- **[DOC] Research-preview gate:** `--channels` only accepts an Anthropic-curated allowlist; a **custom** channel needs **`--dangerously-load-development-channels server:<name>`**, and **Team/Enterprise orgs must enable `channelsEnabled`** first. **[ASSUMED]** Team Premium is a Team org → admin toggle likely required.

---

## Topology — the ~5 interactive sessions

```
 user (once, manually) ──┐  per worker slot W1..W5:
                         ▼     terminal/tmux pane, interactive, subscription auth
  claude --dangerously-load-development-channels server:webhook-W1   (cwd = pool-W1/)
            │ spawns subprocess over stdio
            ▼
     webhook-W1.ts  ── listens 127.0.0.1:8801 (HTTP)  ◄── runner POSTs card here
            │ mcp.notification(...)                        replies via reply tool
            ▼
     <channel> event inside the live W1 session → Claude works the card
```

- **Launched once, by a human, interactively.** Each slot `W1..W5` is a `claude` session the **user** starts in a terminal/tmux pane (or login-item script), authed via `claude auth login` (claude.ai). **`ANTHROPIC_API_KEY` unset** so it can't fall back to API-key auth. This human-started-interactive property is the whole billing argument (vs. a daemon spawning `claude`).
- **Each slot gets its own channel + port.** Worker `Wk` runs `webhook-Wk.ts` bound to `127.0.0.1:880k`, generated from one template (only `name`/`port`/slot id differ).
- **Slot → port mapping** lives in a `workers` registry (Mongo collection or config file): `{ slot, port, status: free|busy, cardId|null, lastSeenAt }`. The runner maps a claimed card → a `free` slot → that slot's port.
- **Each session's cwd is a stable per-slot dir** (`pool-Wk/`), *not* per card — the worker is reused; per-card isolation is via worktrees inside the card's workspace (below).

---

## Dispatch — POST a card into a worker

The runner, on claiming a card, picks a free slot and POSTs to that slot's local port:

```jsonc
POST http://127.0.0.1:8801/        // slot W1
X-Sender: aikanban-runner          // sender-gate token (see failure modes)
{
  "cardId":  "665f…ab12",          // Mongo _id → becomes a <channel> attr for scoping
  "number":  123,
  "workspacePath": "workspaces/card-123",
  "prompt":  "<bootstrap prompt + card title/description + resume note>"
}
```

The channel server forwards it as `<channel source="webhook-W1" card_id="665f…ab12" number="123">…bootstrap prompt; cd into workspaces/card-123, call get_my_task(), work it. </channel>`.

- **Does it need a hook to act?** **No.** The channel server's `instructions` string is injected into Claude's system prompt and tells it what a `<channel>` event means ("a new card arrived: `cd` into `workspacePath`, call `get_my_task`, work it, finish with `set_my_status`"). The inbound event **auto-triggers** a turn — no Stop-hook, no keystrokes.
- **Fully autonomous dispatch** = (claim card) → (POST to free slot) → done. No human after the one-time launch. Permission prompts are the one stall risk, handled by `--dangerously-skip-permissions` at launch (matches the broad/auto permission keystone).
- **`CARD_ID` scoping per dispatch, not per process.** A *reused* worker handles many cards, so the board MCP server **cannot bind a single `CARD_ID` env var** like the per-card-process [scheduler-runner](./scheduler-runner.md) model. Fix: the agent passes `card_id` (from the `<channel>` tag) on every MCP call, and the service rejects a card not currently assigned to that slot — a real change vs. the env-bound scoping in [mcp-api-contract.md](./mcp-api-contract.md#agent-scoping-least-privilege).

---

## Claim mechanism — never double-assign

Reuses the existing atomic claim from [scheduler-runner](./scheduler-runner.md#atomic-pickup), then maps the claimed card to a free slot:

```ts
// 1. atomic card claim (unchanged) — WIP enforced by free-slot count, not --capacity
const card = await cards.findOneAndUpdate(
  { status: "todo", $or: [{ nextStartAfter: null }, { nextStartAfter: { $lte: now } }] },
  { $set: { status: "in_progress", runState: "starting", pickedAt: now }, $inc: { attempts: 1 } },
  { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" },
);
if (!card) return;                         // nothing to pick up

// 2. atomic slot claim — guarantees one card per worker
const slot = await workers.findOneAndUpdate(
  { status: "free" },
  { $set: { status: "busy", cardId: card._id, assignedAt: now } },
  { returnDocument: "after" },
);
if (!slot) { /* no free worker → release card back to todo */ }
```

- **WIP = 5 is the slot count.** `headroom` is backed by **free-slot availability**: only POST if a slot is `free`. Two single-doc atomic updates (card, slot) ⇒ no double-assign.
- **Slot release** on completion: the `set_my_status` handler flips the slot back to `free` (or `busy-waiting` for `need_review`; see below).

---

## Context hygiene between cards

A reused worker carries the prior card's conversation. Per [prior-art §4](./brainstorm-execution-prior-art.md), `/clear` resets context to the system prompt within the same process.

- **Channels can't type `/clear`** (a channel message is content, not a command line):
  - **(a) Dispatch prompt self-reset** — each card's bootstrap begins "new, unrelated card; disregard prior conversation," relying on the worktree/spec-file relay (prior-art §4) so chat history is non-load-bearing. **Cheapest, but context-bleed risk.**
  - **(b) Recycle the session** — on completion the *user-launched wrapper* relaunches a fresh `claude` (must stay human-owned, not a daemon, to keep the billing argument). **Cleanest context, weakest billing story.**
  - **(c) Control message → `/clear` via a Stop hook** — **[ASSUMED] not supported**; no documented "run a slash command" channel verb.
- **Recommendation:** (a) for v1 (matches the spec-file relay the design favors); escalate to (b) if cards leak.

---

## Worktree isolation per card

Unchanged from the keystone. The worker's cwd is the stable `pool-Wk/`, but the dispatch prompt directs it into `workspaces/card-<number>/`, and `add_repo_to_my_workspace` runs `git worktree add … -b aikanban/card-<number>` as in [mcp-api-contract](./mcp-api-contract.md#add_repo_to_workspaceid-repo). Changes live on the card branch on disk, independent of which slot ran them — so a card can be resumed on a *different* slot after a crash.

---

## Completion / handoff

- **Primary signal stays MCP `set_my_status(need_review|done)`** — the board is the source of truth. The runner observes the flip (next tick / service-layer hook) and **frees the slot**.
- **Two-way channel = faster secondary signal:** the worker also calls `reply` ("card 123 → need_review, summary…"); the reply handler notifies the runner immediately so slot release doesn't wait for a poll. **Additive, not authoritative** — MCP status is truth.
- **Contrast with output-parsing (sol-1/sol-3):** no TUI scraping for a done-marker — completion is an explicit tool call + channel `reply`, robust to phrasing. Strictly better than `scrapeStdout`.

---

## Per-card phone reviewability

This is the **weakest point** of a reused-worker model. One long-lived session = one conversation transcript spanning many cards, whereas the keystone wants **each card individually reviewable on the phone**.

- A pool worker is **not** a `claude remote-control --spawn session` per card, so there is **no per-card `https://claude.ai/code/...` URL** to store in `card.session.url` the way [data-model](./data-model.md) and `set_session_url` assume.
- **Mitigations:**
  - **(a) Channel-as-review-surface:** the two-way channel posts per-card progress/questions via `reply`; the board's card-detail timeline (planned, fed by `card_events`) becomes the review surface instead of a claude.ai URL. **Diverges from the "review in Remote Control" keystone.**
  - **(b) Remote Control + channel on one session:** steerable from the phone, but the phone sees the *whole worker* (all cards interleaved), not one card. Poor isolation.
  - **(c) Hybrid:** reused workers for bulk; escalate a `need_review` card into a *fresh* per-card remote-control session for human review. Recovers per-card review, adds cost.
- **Honest read:** Channels optimize *autonomous dispatch*, not *per-card review*; that keystone pushes toward sol-3/sol-4. This candidate trades review granularity for billing- defensible autonomous push.

---

## Billing-safety

**Why more defensible than tmux/pty (sol-1/sol-3):** the message is delivered **into a session a human genuinely started interactively** with a claude.ai OAuth login. We are not faking interactivity — the session *is* interactive; we use the **official, documented** channel mechanism to feed it an event, exactly as Telegram/iMessage do. Contrast [prior-art §1/TL;DR](./brainstorm-execution-prior-art.md): the #2815 argument that bites tmux/pty is that a **daemon spawns its own `claude` process** which Anthropic classifies as programmatic *regardless of TUI rendering*. Here **no daemon spawns `claude`** — the human did — and the runner only does an HTTP POST to a *local* receiver. The invocation surface is the human's interactive session.

**Residual uncertainty (state honestly):**

- **[DOC gap] Docs never state the billing class** — channels support *both* claude.ai and Console API-key auth, so "uses a channel" ≠ "bills as subscription." Safety rests on **unsetting `ANTHROPIC_API_KEY` + claude.ai login** + the session being human-started- interactive. **Strong inference, not a guarantee** — same caveat as Remote Control (§2).
- **[ToS] Automation-around-a-human-session.** We automate the push, not the launch; but a runner POSTing tasks 24/7 into 5 sessions could read as the automated-throughput pattern the split targets (prior-art §6 "automation = metered"). **Core unresolved risk.**
- **[Preview risk] `--dangerously-load-development-channels`** + research-preview: protocol "may change"; not a blessed production path for custom channels yet.

---

## Crash / restart, machine sleep, auth

- **Worker crashes:** slot `lastSeenAt` goes stale; a health check (ping `GET /health` or watch the `claude` PID) marks the slot `down`. The card's `runState` goes dirty → existing [crash recovery](./scheduler-runner.md#crash-recovery-decided-auto-restart-fresh) restarts it **on a different free slot** (worktree survives; chat transcript lost).
- **Re-launching a dead worker** must be **human-owned** (a login-item/launchd wrapper the *user* installed, started under their interactive login + claude.ai token). A scheduler auto-spawning `claude` relapses into the programmatic-classification trap.
- **Machine sleep:** sessions pause; POSTs land on a dead port (connection refused) → the runner treats POST failure as "slot unavailable" and does not mark the card claimed. The user's wrapper restores slots on wake.
- **Auth expiry:** token expiry kills a worker → health-check → slot `down` + a board flag to `claude auth login` again. No API-key fallback (env intentionally unset).

---

## Tradeoffs / principles / priorities

- **Principle:** stay on the *one documented* push-into-interactive-session mechanism; never spawn `claude` from a daemon. Automate only the POST.
- **Priority order:** billing-defensibility > autonomy > per-card review granularity.
- **vs sol-1 (tmux):** official structured event vs keystroke injection — no `C-m`/timing fragility, far better billing story (no daemon-spawned process); but sol-1 keeps per-card review easier if each pane is per-card.
- **vs sol-2 (mcp-pull):** sol-2's self-pull also avoids injection and may be the safer sibling; sol-5's push gives tighter dispatch control + a two-way completion channel.
- **vs sol-3 (pty-per-card):** sol-3 gives clean context + per-card review but the worst billing story (daemon spawns `claude` per card). sol-5 inverts that trade.

## Assumptions to verify

1. **Does a channel-driven turn on a claude.ai-authed, human-started session bill as subscription?** (Undocumented; the whole bet.) → controlled probe once safe.
2. **Does Team Premium require the admin `channelsEnabled` toggle**, and can a solo user flip it? (Likely yes.)
3. **`--dangerously-load-development-channels` longevity** — will custom channels leave research preview / get an allowlist path?
4. **`card_id`-scoped MCP for a reused worker** is implementable in the existing contract.
5. **`--dangerously-skip-permissions` coexists with channels** for unattended runs (docs say yes; verify with worktree git ops).

## Failure modes

- **Silent drop:** fire-and-forget POST vanishes if the session lost the channel → require a channel `reply` ack within `T`; on no-ack, release slot + card and retry.
- **Prompt-injection:** the local port is an injection vector → bind `127.0.0.1` only + `X-Sender` token gate (docs' sender-gate pattern).
- **Event batching cross-talk:** two POSTs to a busy worker handled as one group → never POST a second card to a `busy` slot (slot-claim guarantees this).
- **Context bleed** (see hygiene); **slot/PID drift** after a scheduler restart → reconcile re-reads the `workers` registry + health-checks each port before trusting `free`.

---

## Verdict

| Axis | Stars | Note |
| ---- | ----- | ---- |
| **Autonomy** | ★★★★☆ | Auto-acts on inbound (no human ack); only the one-time launch + permission prompts are non-autonomous. |
| **Billing-safety** | ★★★☆☆ | Best-of-breed *argument* (official push into a human-started interactive subscription session, no daemon-spawned `claude`), but billing class is undocumented and 24/7 push may read as the metered-automation pattern. |
| **Robustness** | ★★★☆☆ | Structured events + two-way ack beat output-parsing, but fire-and-forget delivery, research-preview/dev-flag status, and reused-worker context hygiene add fragility. |
| **Build-effort** | ★★★☆☆ | Reuses the atomic-claim + worktree + MCP contract; net-new = per-slot channel servers, slot registry, `card_id`-scoped MCP, health checks, human-owned relaunch wrapper. |
