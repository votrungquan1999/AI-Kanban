> Candidate #4 for [brainstorm-execution-billing.md](./brainstorm-execution-billing.md). Sibling candidates: sol-1 (tmux-pool), sol-2 (mcp-pull), sol-3 (pty-per-card).

# Candidate #4 — Dispatch mediated through claude.ai Remote Control

The seed idea, taken at its most literal: **the phone IS the control plane.** Don't build a separate injection channel — reuse the one channel the user already has into their running local sessions, the **claude.ai Remote Control** surface. Dispatch a card by *talking to a worker through the remote feature*, exactly as the user phrased it.

This is the **billing-safety-maximal, autonomy-minimal** corner of the solution space. Every other candidate (sol-1 tmux `send-keys`, sol-2 MCP self-pull, sol-3 pty-per-card) tries to make the *injection* itself automated-but-interactive. This one sidesteps the whole "is the injection programmatic?" question by routing dispatch through a surface that is **interactive by construction** — a human (or, conditionally, a remote API) typing a message to a live session.

---

## What Remote Control actually is (factual, with flagged unknowns)

From the [scheduling-capabilities research](../research/claude-scheduling-capabilities.md) and the [design README](../design/README.md):

- A **background agent** (`claude --bg` / `remote-control --spawn`) launches an **independent local session** with full local FS/worktree access and **its own claude.ai URL**. That URL is the Remote Control surface: open it on the phone, see the session's transcript, and **send messages into the running local session** from the browser. The compute stays local; the phone is a thin remote terminal.
- This is the keystone of Path C: per-card review happens by opening each card's stored `session.url` on the phone. The board ([web-ui.md](../design/web-ui.md)) links out to these URLs.
- **Billing:** a Remote Control session is a genuinely-interactive Claude Code session. A human typing into it is the canonical *interactive* usage that stays on the subscription post-June-15. This is the property the whole brainstorm is chasing.

**Flagged unknowns (assumptions-to-verify):**

- **U1 — Remote message API.** Whether there is *any* programmatic way to POST a message into a running session via Remote Control (vs. strictly a human typing in the browser). A sibling agent is researching this; this doc designs for **both** outcomes. Default assumption: **no public programmatic channel → human-in-loop only.**
- **U2 — Multi-session phone UX.** Whether claude.ai cleanly lists ~5 concurrent background sessions and lets the user switch between them on a phone. Assume yes (each has a URL), but the *ergonomics* of 5-at-once on a small screen are unverified.
- **U3 — Re-attach.** [scheduler-runner.md](../design/scheduler-runner.md) (Spike #1) states there is **no Remote-Control re-attach API** — a crashed session can't be re-adopted; we always spawn fresh. That constraint carries into this design.

---

## The core inversion vs. the locked design

In the locked [scheduler-runner](../design/scheduler-runner.md) loop, the **board is the task queue** and an agent self-serves via MCP (`get_my_task`). A session is spawned *already bound to one card* (`CARD_ID` env-injected) and never needs dispatch.

Candidate #4 keeps a **pool of generic, card-agnostic workers** instead. A worker is a long-lived Remote Control session sitting idle at a prompt. Dispatch = **handing a card to a worker by sending it a message** ("work card 123: <title/desc>, repos already in your cwd"). The board now serves a second role beyond review: it is the **dispatch console**.

```
 ┌─ user's Mac (awake) ──────────────────────────┐      ┌ cloud ┐
 │  worker pool: 5 × `claude remote-control`      │      │       │
 │   W1 idle  W2 busy(card-7)  W3 idle  W4 …  W5 … │      │ Atlas │◄─ board / dispatch
 │     ▲ message-in (human tap → Remote Control)  │      │       │      console (phone)
 └─────┼──────────────────────────────────────────┘      └───────┘────────┘
       └──────────── claude.ai Remote Control ◄──────── phone taps "assign card-7 → W2"
```

---

## Variant (a) — Human-in-loop dispatch (the default, ships without U1)

**The board UX.** The phone board gains a thin **dispatch lane** alongside the four kanban columns:

- **Todo column** as today: unclaimed cards, priority-ordered.
- **Worker tray** (new): the 5 pool workers, each showing `idle` / `busy(card-N)` / `crashed`. Rendered from a new `workers` registry (below). Each worker row links to its Remote Control URL.
- **Assign gesture:** the user taps a Todo card, then taps a free worker (or drags card → worker). That single human action is the dispatch.

**How a tap becomes a message into a session.** The tap hits a board **Server Action** ([web-ui.md](../design/web-ui.md) pattern) that does two things atomically-ish:

1. **Claim** (Mongo): `findOneAndUpdate({_id: card, status:"todo"} → status:"in_progress", assignedWorker: W2, runState:"running")` — the existing atomic-pickup pattern from [data-model.md](../design/data-model.md#concurrency-patterns-mongodb-specific), now also stamping the worker. Single-doc atomicity → no double-assign.
2. **Deliver the message** into W2's session. *Here is the honest seam:* if U1 is false (no programmatic remote API), **the message delivery is the human action itself** — the board, after claiming, **deep-links the user straight into W2's Remote Control chat with a pre-filled message** ("Work card-7. Title… Description… Your worktrees are in cwd; call `set_my_status` when done.") The user taps **send** on the phone. *That send is the interactive, subscription-billed event.* The board's job is reduced to: claim the card, prep the worktrees, and compose+route the prompt to the right session's chat box.

   - **Worktree prep is local & automated** (no Claude tokens): the runner, watching the `assignedWorker` stamp, materializes `workspaces/card-7/` worktrees and (because the worker's `cwd` is fixed) either points the worker at the card folder via the message ("cd into …") or runs one card-agnostic worker **per fixed cwd** and passes paths in the prompt. (Open: per-worker fixed cwd vs. per-card cwd — see Isolation below.)

**Claim mechanism.** Identical to the locked loop's atomic claim, triggered by the human tap instead of the reconcile tick's headroom check. The reconcile loop still runs for **crash recovery and intake**, but **pickup is human-gated** — it never auto-claims; it only surfaces Todo + free workers and waits for a tap.

**Worker registry (new `workers` collection).**

```js
{ _id, name: "W2", sessionUrl, sessionId, runState: "idle"|"busy"|"crashed",
  currentCardId: ObjectId | null, cwd: "workspaces/worker-2", pid, startedAt, lastSeenAt }
```

Mirrors the per-card runtime fields already on `cards`. The reconcile loop reconciles **workers** (alive? idle?) the same way it reconciles cards.

**Why this stays fully subscription-billed.** Two automated parts — the claim and worktree prep — **spend zero Claude tokens** (pure Mongo + git). The only Claude interaction is (i) the human pressing send in Remote Control, and (ii) the worker doing the long interactive work and pausing at `need_review`. Both are textbook interactive Claude Code. There is **no `claude -p`, no Agent SDK, no headless** anywhere in the path. **Billing-safe by construction, no empirical verification needed.**

**How autonomous is this, honestly?** It is **semi-autonomous**: the human is the scheduler's *trigger*, the agent is the *executor*. The loop does NOT pull cards on its own — a person decides "now, this card, that worker" and presses send. Everything after send (multi-step coding, repo discovery, self-status, pausing for review) is fully autonomous. So it trades the "wake up to N finished cards" dream for "I tap 5 cards onto workers in 30 seconds from my phone, then they grind." For a phone-first solo user this may be an acceptable — even *desirable* — amount of control. But call it what it is: **a human dispatch loop, not an autonomous one.**

---

## Variant (b) — Programmatic remote dispatch (conditional on U1)

**IF** the sibling research finds a programmatic channel to inject a message into a running Remote Control session (a documented endpoint, an authenticated API, or a stable local IPC the `remote-control` process exposes), then the human tap becomes optional and the design collapses into the locked reconcile loop with a different delivery verb:

- Reconcile tick's pickup step claims a Todo card AND picks a free worker, then **calls the remote-message API** to deliver the same composed prompt. No human in the path.
- Everything else (registry, worktree prep, billing path of the *worker's* execution) is identical to (a).

**The load-bearing billing question for (b):** does a message delivered *programmatically into an interactive session* keep that turn on the subscription, or does Anthropic classify the **injection** as programmatic (like Agent SDK) and meter it? This is the exact ambiguity the whole brainstorm exists to avoid. **Mark (b) as assumption-to-verify and do NOT build it speculatively.** Even if a remote API exists (U1 true), its *billing classification* is a second, independent unknown (call it **U1b**) that must be confirmed before relying on it. Until both clear, (a) is the shipping path.

Design stance: **build (a); leave a `dispatch.mode = "human" | "programmatic"` seam** so that flipping to (b) is a one-adapter change (`deliverMessage(worker, prompt)`), not a rearchitecture. The claim, registry, worktree prep, and review surface are shared.

---

## Pool of ~5 — registry, context hygiene, isolation

- **Pool size 5** = WIP limit. 5 long-lived `claude remote-control` workers spawned at boot, registered in `workers`. The reconcile loop keeps exactly 5 alive (respawn dead ones), the dispatch step never assigns to a `busy` worker → natural WIP enforcement (mirrors the loop's "WIP enforced by us, not `--capacity`").
- **Context hygiene (reused workers).** A reused worker carries the prior card's transcript. Before/after each card, the dispatch prompt **must reset context** — either `/clear` (new conversation in the same session) injected as part of the dispatch message, or the bootstrap-prompt convention ([bootstrap-prompt.md](../design/bootstrap-prompt.md)) re-stated each card so the worker treats every card as a clean slate. **Risk:** if `/clear` is unreliable through Remote Control, prior-card context leaks across cards — a correctness hazard unique to the reused-pool model (sol-3 pty-per-card avoids this entirely by being ephemeral).
- **Worktree isolation per card.** Regardless of session reuse, **each card gets its own worktrees** under `workspaces/card-N/` on branch `aikanban/card-N` — unchanged from the locked model. The open tension: a worker's `cwd` is fixed at spawn, but cards need per-card folders. Two options:
  1. **Per-card cwd, ephemeral-ish worker:** kill+respawn the worker with the new card's cwd. This is basically sol-3 (pty-per-card) wearing a Remote-Control hat; loses the "reused long-lived pool" benefit but gives clean isolation + clean context.
  2. **Fixed per-worker cwd, card folder passed in prompt:** worker stays alive; the dispatch message tells it which `workspaces/card-N/` to operate in. Reuses the session (cheaper, matches seed idea) but relies on the agent respecting the path and on `/clear` for hygiene. **Lean: option 2** to honor the seed idea, with option 1 as the fallback if context-leak proves real.

---

## Per-card phone reviewability — the approach's natural strength

This is where Candidate #4 shines and the others strain. **The board is already the phone surface, and now it is also the dispatch surface — review and dispatch coexist on one screen.** The flow is seamless:

- **Dispatch:** glance at Todo + worker tray, tap to assign, press send. Phone-native.
- **Monitor:** worker tray shows `busy(card-N)`; tap a worker to jump into its live Remote Control transcript.
- **Review:** when a worker hits `need_review`, its card moves to the Need Review column (existing two-axis state); the same Remote Control session is *still alive* (keep-alive through review, per the locked loop), so the user steers it from the phone — answer a question, approve, redirect — **in the very session that did the work.** No re-attach needed, no lost context, because the session never died.

**Reviewability caveat for reused workers (option 2).** Because one worker session spans multiple cards sequentially, "review card 7" means scrolling that worker's transcript to the card-7 segment. If `/clear` starts a fresh conversation per card, each card gets a clean transcript region but they share one session URL → review is **per-worker, not per-card-URL**. This partially erodes the "one reviewable URL per card" keystone. The board can compensate by storing, on each card, the `workerSessionUrl + a timestamp/anchor` so the card-detail view deep-links to the right point. **Honest gap vs. sol-3**, which gives a genuinely distinct URL per card.

---

## Completion / handoff, crash / restart, sleep, auth

- **Completion / handoff.** Worker calls `set_my_status(done)` via the existing card-scoped MCP (the worker knows its `CARD_ID` from the dispatch prompt). Board moves card → Done; runner frees the worker (`workers.runState → idle`, `currentCardId → null`), optionally injects `/clear`. Worker is now assignable again. Worktree cleanup per the locked loop's open question (on done vs. on merge).
- **Crash / restart.** Two layers. (1) A **card** mid-flight whose worker died: the reconcile loop's invariant #2 detects `currentCardId set + pid dead`, frees the card back toward recovery. Because **no re-attach (U3)**, recovery = respawn a fresh worker and **re-dispatch** the card (worktree changes survived on disk → work continues; transcript lost). In variant (a) re-dispatch needs a human tap again (or a board-surfaced "re-assign" prompt); in (b) the loop re-dispatches automatically. (2) A **worker** process dying while idle: loop respawns it to keep the pool at 5.
- **Machine sleep.** Same constraint as every candidate: the Mac must be **awake** to run workers (`caffeinate`, launchd LaunchAgent per [deploy-custom-scheduler](../research/README.md)). The board (Vercel→Atlas) stays reachable on the phone while asleep, but **no dispatch can be delivered to a sleeping worker** — taps queue (card stays `todo`/claimed-pending) until wake. Acceptable for a laptop-on-desk solo flow.
- **Auth (unattended subscription OAuth).** Workers are spawned by a launchd agent with **`ANTHROPIC_API_KEY` unset** and subscription OAuth provisioned (`CLAUDE_CODE_OAUTH_TOKEN` / persisted credentials) so every worker is a subscription interactive session — the same auth posture all candidates need (research open Q2). The **Remote Control link** is what the phone authenticates against (the user's own claude.ai login), independent of the worker's local OAuth.

---

## Tradeoffs / principles / priorities

- **Priority: billing-safety > autonomy.** Variant (a) is the *only* candidate that needs **zero empirical billing verification** — the dispatch is literally a human pressing send. That is its whole reason to exist.
- **Principle: reuse the surface you already have.** No new injection mechanism, no tmux/pty/expect fragility (sol-1/sol-3), no queue-level MCP refactor (sol-2). The phone board does double duty.
- **Principle: keep an adapter seam** (`deliverMessage`) so a future verified remote API (b) upgrades dispatch without touching claim/registry/review.
- **Trade-off accepted:** not autonomous in the "unattended overnight" sense. Human is the trigger. For a phone-first solo user this is plausibly fine; for a fire-and-forget fleet it is a non-starter.

## Assumptions-to-verify

- **U1** — any programmatic message-into-running-session channel exists (sibling research).
- **U1b** — *if* U1, whether such an injected turn is still subscription-billed (the very ambiguity the brainstorm avoids; independent of U1).
- **U2** — phone UX for ~5 concurrent sessions in claude.ai is usable.
- **U3** — confirmed no re-attach (Spike #1) → recovery always re-dispatches fresh.
- **U4** — `/clear` works reliably through Remote Control for context hygiene (reused pool).

## Failure modes

- **Context leak** between cards on a reused worker if `/clear` is flaky (U4) → wrong-card edits. Mitigation: fall back to per-card respawn (≈ sol-3).
- **Human bottleneck**: nobody taps → nothing runs. The autonomy cost made literal.
- **Worktree/cwd mismatch**: worker operates in the wrong folder if the prompt path is ignored. Mitigation: per-card cwd (option 1) eliminates it.
- **Review fragmentation**: per-worker (not per-card) URLs erode the keystone; mitigated by storing per-card session anchors but never as clean as a per-card URL.
- **Sleep-stalled dispatch**: taps to a sleeping Mac silently queue.

---

## Verdict

| Dimension | Stars | Note |
| --- | --- | --- |
| Autonomy | ★★☆☆☆ | Semi-autonomous: human triggers each dispatch (a). ★★★★☆ only **if** (b) verifies (U1+U1b). |
| Billing-safety | ★★★★★ | Variant (a) needs zero empirical verification — dispatch is a human send; execution is plain interactive Claude Code. |
| Robustness | ★★★☆☆ | No new fragile injection layer, but reused-pool context hygiene (U4), no re-attach (U3), and human-bottleneck/sleep stalls drag it down. |
| Build-effort | ★★★★☆ | Low: reuse board + Remote Control; add a `workers` registry, a dispatch lane, worktree-prep, and a `deliverMessage` seam. No tmux/pty/MCP-refactor. |
