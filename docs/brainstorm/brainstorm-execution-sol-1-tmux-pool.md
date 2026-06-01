> Candidate #1 for [brainstorm-execution-billing.md](./brainstorm-execution-billing.md). Sibling candidates: sol-2 (mcp-pull), sol-3 (pty-per-card), sol-4 (remote-control).

# Candidate #1 — tmux/expect pool of persistent interactive workers

A fixed pool of ~5 **genuinely-interactive** `claude` REPLs, each living in its own terminal-multiplexer pane. A thin local runner claims Todo cards from Mongo, picks a free worker, **injects** the task by typing into that worker's pane (as a human would), detects completion, then resets the worker for the next card. The whole premise: typing into a real interactive TTY is indistinguishable from a human at the keyboard, so it should bill against the **subscription**, not the metered Agent-SDK pool.

Carries the keystones from [billing](./brainstorm-execution-billing.md#what-must-be-preserved-keystone-still-locked): local-first worktrees, Mongo claim loop, per-card phone review, the [MCP contract](../design/mcp-api-contract.md) (`get_my_task`/`set_my_status`).

---

## Topology

```
 ┌─ user's Mac (awake; caffeinate) ─────────────────────────────────────┐
 │ launchd LaunchAgent                                                   │
 │   ├─ runner (Node, in-process scheduler tick ~15–30s)                 │
 │   │     ├─ atomicClaim() todo→in_progress  (Mongo)                    │
 │   │     ├─ worker registry (in-memory + Mongo mirror)                 │
 │   │     └─ inject / detect / reset  via tmux CLI                      │
 │   └─ tmux server (session "aikanban")                                 │
 │         ├─ pane worker-0 : claude (interactive REPL, cwd=slot dir)    │
 │         ├─ pane worker-1 : claude  ...                                │
 │         └─ pane worker-4 : claude                                     │
 └──────────────────────────────────────────────┬────────────────────────┘
                                                 │ Atlas M0
   board (Vercel) ◄── phone                      ▼  cards / card_events
```

- **Processes:** one tmux **server**, one tmux **session** (`aikanban`) holding ~5 **windows/panes** (one per worker), plus the Node runner. The runner does **not** spawn `claude` per card — workers are long-lived and reused.
- **Launching workers as interactive sessions (not `-p`/SDK):** at boot the runner runs `tmux new-session -d -s aikanban -n worker-0` then `tmux send-keys -t aikanban:worker-0 'claude' Enter` for each slot. The command launched is the **bare `claude` REPL** — no `-p`, no `claude-agent-sdk`, no `--bg`. Each pane is a real pty with a real prompt waiting for keystrokes. This is the crux of the billing claim.
- **Addressing:** panes are addressed by stable target ids `aikanban:worker-N`. The runner never relies on pane index numbers (they renumber); it uses the **named window** per slot. A `tmux list-panes -F '#{window_name} #{pane_pid} #{pane_dead}'` gives a health snapshot.
- **Runner ↔ worker channel:** outbound = `tmux send-keys` (type prompt) and `tmux send-keys C-l`/slash-commands (control). Inbound (did it finish?) = **NOT** the pane text — see [Completion detection](#completion-detection): we use the MCP `set_my_status` write to Mongo as the real signal, and `tmux capture-pane` only as a liveness/diagnostic fallback.

---

## Dispatch / injection

A card is dispatched to worker N by **typing a prompt into its pane**:

1. Runner builds the bootstrap text: `"Your card id is <CARD_ID>. Run get_my_task to read your assignment, confirm repos, do the work, then call set_my_status. Begin now."`
2. `tmux send-keys -t aikanban:worker-N -l -- "<bootstrap text>"` (the `-l` = literal, so backticks/quotes in the prompt aren't interpreted by tmux as key names).
3. A **separate** `tmux send-keys -t aikanban:worker-N Enter` to submit. (Splitting the literal payload from the Enter avoids the classic "newline inside multi-line paste submits early" bug. For multi-line prompts, send via a **bracketed-paste** sequence or load the prompt from a temp file the worker reads, rather than typing raw newlines.)
4. **Which card / which worktree:** the worker does *not* get `CARD_ID` from an env var here (the env was fixed when `claude` launched, before any card existed). Two options:
   - **(a) In-band** — the `CARD_ID` is in the typed prompt (above), and the worker's MCP server is the *unscoped* internal service; the agent passes the id it was told. This **breaks the card-scoping least-privilege** of the [MCP contract](../design/mcp-api-contract.md#agent-scoping-least-privilege) — a reused worker can't have `CARD_ID` baked into its MCP server env.
   - **(b) Re-exec the MCP connection** — before injecting, the runner reconfigures the worker's MCP server for the new `CARD_ID` (e.g. `/mcp` reconnect, or a control tool `bind_card(CARD_ID)` the runner is allowed to call). Cleaner scoping, more moving parts. **Assumption to verify.**
- **cwd / worktree** is communicated by telling the worker its slot's working directory in the prompt and having it `cd`, or by pre-`cd`-ing the pane before relaunch (see [Worktree isolation](#worktree-isolation)).

---

## Claim mechanism

Reuses the drafted [atomic pickup](../design/scheduler-runner.md#atomic-pickup), with a **two-resource** twist: claiming a *card* AND reserving a *worker slot* must not race.

- **Card claim:** unchanged `findOneAndUpdate({status:"todo"}, {$set:{status:"in_progress", runState:"starting"}}, {sort:{priority:-1,createdAt:1}})`. Single-doc atomic → no double-pickup of a card across overlapping ticks.
- **Worker registry:** an array of 5 slots `{ slot, target:"aikanban:worker-N", state: "free"|"busy", cardId, cardNumber, leaseUntil }`. **Where it lives:** primary copy is **in-memory in the runner** (the runner is the single owner of the tmux server, so it is the single writer); **mirrored to Mongo** (`workers` collection) for crash recovery and board visibility. In-memory is the source of truth while the runner is up.
- **No double-assignment of a worker across two ticks:** the runner is **single-process, single-threaded per tick** — pickup is a synchronous loop, so two ticks cannot overlap *within one runner*. To be safe against a second runner, slot reservation is itself an atomic Mongo op: `workers.findOneAndUpdate({state:"free"}, {$set:{state:"busy", cardId, leaseUntil:now+T}})`. Order: **reserve a free worker FIRST, then claim a card; if no card, release the worker.** (Reserving the scarcer resource last avoids claiming a card you can't place — but a card claimed-then-unplaceable is recoverable on the next tick via reconcile, whereas a leaked busy worker is not, so reserve-worker-first is the safer ordering.) WIP limit = pool size = 5; headroom = count of `free` workers.

---

## Context hygiene

A reused worker carries card N's transcript into card N+1 unless explicitly cleared.

- **Reset between cards:** after a card completes, runner sends `/clear` (Claude Code's conversation reset) to the pane, then waits and **verifies**. `/clear` wipes the conversation context in-place without killing the process — exactly what a reused interactive worker needs.
- **Verifying the reset happened:** `tmux capture-pane -p -t aikanban:worker-N` and check the buffer shows the fresh-prompt banner / empty-context state, not the prior card's tail. Belt-and-suspenders: send a **canary** ("reply with the single token READY") and confirm the worker has no memory of the prior card before injecting card N+1.
- **Stronger option:** don't `/clear`, instead **kill + relaunch** the pane's `claude` for each card (fresh process, guaranteed-clean context). This converges toward [sol-3 (pty-per-card)](./brainstorm-execution-sol-3-pty-per-card.md) and loses the "warm worker" benefit, but is the most robust hygiene. The reused-worker bet is that `/clear` is sufficient — **assumption to verify.**

---

## Worktree isolation

The locked model is **per-card** worktrees (`workspaces/card-N/<repo>`, branch `aikanban/card-N`), not per-worker.

- Each **card** still gets its own worktree set, created at pickup (`add_repo_to_my_workspace` / runner pre-creates `workspaces/card-N/`). A reused worker works on **a different directory each card**.
- **cwd handling:** a bare `claude` REPL's cwd is fixed at launch and can't be changed by the process mid-session. So the worker must `cd workspaces/card-N` (told via the injected prompt) — but Claude Code's file tools are rooted at the **launch cwd**, so a mid-session `cd` in the shell doesn't move the agent's project root. **This is a real friction:** to truly reroot per card, you must **relaunch `claude` in the new cwd** (`tmux send-keys 'cd workspaces/card-N && claude' Enter`) — which is effectively the kill+relaunch hygiene option above. **Assumption to verify:** whether a long-lived worker can retarget its project root per card without relaunch (likely no).
- Net: per-card worktree isolation pushes this design toward relaunch-per-card, eroding the "persistent warm pool" advantage.

---

## Completion detection (the honest weak point)

Keystroke-driving gives the runner **no clean callback** when the agent finishes. Three signals, in order of trust:

1. **MCP `set_my_status(need_review|done)` → Mongo (primary, trusted).** The agent already moves its own card via the [MCP contract](../design/mcp-api-contract.md). The runner **polls Mongo** for `status` leaving `in_progress`; that is the authoritative "card N done, free the worker" event. This sidesteps pane-scraping entirely for the happy path and is the same mechanism sol-2 leans on.
2. **`tmux capture-pane` parsing (fallback, fragile).** If the agent stalls without calling `set_my_status` (asked a question, errored, hit a permission prompt), the runner scrapes the pane for the idle prompt / a known question pattern. This is brittle: ANSI colour codes, spinner redraws, and TUI repaints make the buffer noisy and version-sensitive. Use it only to **detect stuck/waiting**, never to confirm success.
3. **Idle timeout + lease.** Each assignment has a `leaseUntil`. If neither (1) nor (2) fires by the lease, the runner flags the worker `waiting`/`stuck` for human or recovery, and does **not** silently reassign.

**Honest take:** detection is this approach's softest spot. We are deliberately making the MCP DB write the contract for completion and treating the terminal purely as an *input* device, so the unreliable direction (reading the pane) is off the happy path.

---

## Per-card phone reviewability

Tension: a worker is **one long claude.ai session**, but review is **per-card**.

- A bare interactive `claude` REPL is a *terminal* session; it does not by itself mint a per-conversation claude.ai Remote-Control URL the way `claude --bg` does. So the natural review surface here is **per-worker** (the worker's running session), not per-card — which **violates the per-card review keystone**.
- **Mitigations:**
  - If `/clear` starts a new conversation with its own shareable claude.ai URL, the runner captures that URL per card and stores it on the card (`set_session_url`), restoring a per-card surface. **Assumption to verify** (does a `/clear`'d interactive session expose a fresh remote URL?).
  - Otherwise review degrades to **per-worker**: the phone sees "worker-2 is on card 47", and per-card history comes from the `card_events` audit log + the worktree diff, not a live claude.ai thread. Acceptable as a fallback but a clear keystone regression.
- This is the **second-softest spot** after completion detection, and it is the one most likely to disqualify the approach against the keystone.

---

## Crash / restart recovery

- **A worker's `claude` dies:** `tmux` keeps the (now dead) pane; runner detects via `pane_dead`/`pane_pid` poll, marks the slot `free` after releasing its card back (`in_progress`→ reconcile restarts it), and relaunches `claude` in the slot. Worktree changes survive on disk (same as the [decided recovery](../design/scheduler-runner.md#crash-recovery-decided-auto-restart-fresh)).
- **The runner dies, tmux survives:** on restart the runner **re-adopts** the tmux session (it's detached and independent of the runner process), rebuilds the worker registry from the `workers` Mongo mirror + a live `tmux list-panes`, and reconciles cards. Detaching the multiplexer from the runner is the whole point of using tmux vs. raw child ptys.
- **The machine sleeps:** `caffeinate -is` under launchd; on wake, reconcile + lease expiry clean up any half-injected state.
- **send-keys lands in the wrong state** (the worker was at a y/N permission prompt, or mid-`/clear`, when the prompt arrived): the most dangerous failure. Mitigations: capture-pane **gate** before every injection (only inject when the pane shows the idle input prompt), a unique **echo canary** before the real prompt, and the lease/idle timeout to catch a payload that vanished into the wrong reader. Still, a stray Enter or a prompt typed into a confirmation dialog can mis-fire — inherent to keystroke driving.

---

## Auth

- **Subscription OAuth, unattended:** launch each worker with `CLAUDE_CODE_OAUTH_TOKEN` (the subscription token from `claude setup-token`) in the launchd `EnvironmentVariables` / the tmux server env, so the REPL is authed without an interactive browser login.
- **Hard-unset `ANTHROPIC_API_KEY`** (and `ANTHROPIC_AUTH_TOKEN`) in the launchd plist and the tmux server environment, so the worker can **never silently fall back to API billing**. A startup assertion (`env | grep -q ANTHROPIC_API_KEY && exit 1`) fails fast if it leaks in. This matters more here than anywhere: the whole approach exists to stay on the subscription.
- **Verify** the interactive-pane path is in fact billed to the subscription post-June-15 (delegated to the billing-research agent; this design assumes "yes, typing into a real REPL = interactive").

---

## Tradeoffs / principles / priorities

- **Principle:** *be a human at the keyboard.* The more the runner looks like a person typing into a real REPL, the safer the billing classification — that is the entire reason to tolerate the keystroke-driving pain.
- **Priority order:** billing-safety > autonomy > per-card review > build simplicity.
- **For:** workers stay warm (no per-card cold-start), tmux gives free detach/persistence/ re-adoption across runner restarts, and completion rides the already-built MCP/Mongo path.
- **Against:** keystroke injection is **stringly-typed and stateful** — no structured request/response, fragile to TUI repaints and prompt-state races; per-card cwd rerooting and per-card review both push back toward relaunch-per-card (eroding the "pool" benefit and converging on [sol-3](./brainstorm-execution-sol-3-pty-per-card.md)); and the cleanest completion signal (MCP→Mongo) is identical to what [sol-2 (mcp-pull)](./brainstorm-execution-sol-2-mcp-pull.md) uses **without** any injection — raising the question of whether send-keys earns its complexity.

## Assumptions to verify

1. Typing into a bare interactive `claude` REPL bills to the **subscription** post-June-15 (the load-bearing billing assumption — owned by the research agent).
2. `/clear` fully resets conversation context in-place (no leakage card N→N+1).
3. A reused worker can **retarget its project root / cwd per card** without relaunching `claude` (suspected **false** → forces relaunch-per-card).
4. A per-card claude.ai **review URL** is obtainable from a reused/cleared interactive session (else per-card review keystone breaks).
5. MCP server can be **re-bound to a new `CARD_ID`** on a reused worker without relaunch (for least-privilege scoping).
6. `tmux send-keys` reliably delivers multi-line prompts without premature submission (bracketed-paste / temp-file injection).

## Failure modes

- **Mis-fired keystrokes** into a y/N prompt or mid-`/clear` state → wrong action, hard to detect. (Gate on capture-pane idle + echo canary.)
- **Silent stall** — agent never calls `set_my_status`; only caught by lease/idle timeout.
- **Context bleed** if `/clear` is incomplete → card N's repo context contaminates N+1.
- **API-billing leak** if `ANTHROPIC_API_KEY` is present anywhere in the env chain.
- **Pane-parse drift** across Claude Code versions breaks the fallback detector.
- **Per-card review regression** to per-worker if no fresh URL is mintable.

## Verdict (self-assessment)

| Dimension | Stars | Note |
| --------- | ----- | ---- |
| Autonomy | ★★★★☆ | Fully automated dispatch; stalls need lease/human nudge. |
| Billing-safety | ★★★★☆ | Strongest "interactive by nature" story — *if* assumption #1 holds. |
| Robustness | ★★☆☆☆ | Keystroke state-races + fragile pane-parsing + per-card cwd/review friction. |
| Build-effort | ★★☆☆☆ | tmux orchestration, capture-pane gating, MCP re-bind, registry mirror — a lot of glue. |
