# Overview — the five execution candidates

> Plain-language summary of the five candidates. Detail lives in each sol doc; the comparison + recommendation lives in [brainstorm-execution-synthesis.md](./brainstorm-execution-synthesis.md). Shared constraint: [brainstorm-execution-billing.md](./brainstorm-execution-billing.md).

The shared constraint behind all five candidates: each card's per-card Claude session MUST bill against the user's Team Premium subscription (interactive Claude Code usage), NOT the post-June-15 metered Agent SDK / headless credit pool, whose ~$100/mo allowance is too small for this project's token appetite. Concurrency is fixed at a pool of ~5. Despite their different dispatch mechanisms, all candidates share the same backbone: an atomic Mongo `findOneAndUpdate` claim (no two workers grab the same card), a WIP cap equal to the pool size, a per-card git worktree (`workspaces/card-N/`, branch `aikanban/card-N`), and MCP-driven completion (the agent calls `set_my_status(need_review|done)` and the board reads Mongo as the source of truth).

## Status (updated May 31)

Live decisions after reviewing this overview with the user: ❌ **Candidate 1 dropped** · ✅ **Candidate 2 kept** (corrected; see variant 2′) · ✅ **Candidate 3 kept** (verified) · 🔁 **Candidate 4 reworked** into a `/work-card <id>` skill that merges into 2′ · ❌ **Candidate 5 no-go**.

**Shortlist: 2′** (reused session + `/work-card` skill — billing-safe, semi-autonomous) **vs. 3** (pty per-card — fully autonomous, but rests on the unverified A-1 billing bet). Staged path: ship 2′ now, add 3 as the autonomous upgrade if its billing clears post-June-15. The per-candidate **UPDATE** notes below carry the verified facts and corrections.

## Candidate 1 — tmux/expect worker pool

See [brainstorm-execution-sol-1-tmux-pool.md](./brainstorm-execution-sol-1-tmux-pool.md).

**UPDATE — ❌ DROPPED (May 31):** Strictly dominated — sol-2/sol-3 get the same clean MCP→Mongo completion without fragile keystroke injection, and prior-art flags faking interactivity as the billing/ToS-risky path. (For the record, the two original worries don't hold: the server *does* know what to type — the bootstrap prompt is templated from the card — and it *does* know when work finished — the agent calls `set_my_status`→Mongo; completion is read from the DB, never scraped from the terminal.)

**In one line:** A fixed pool of ~5 persistent interactive `claude` REPLs, each in its own tmux pane, driven by typing keystrokes into the pane as a human would.

**How it works:** At boot the runner launches ~5 bare `claude` REPLs (no `-p`, no SDK) in named tmux panes, each a real pty waiting for input. A Node runner claims a Todo card from Mongo, reserves a free worker slot, and injects the task by typing a bootstrap prompt into that pane via `tmux send-keys`. Workers are long-lived and reused across cards; between cards the runner resets context (`/clear`, verified via `capture-pane`) or kills-and-relaunches the pane. The premise is that typing into a real interactive TTY is indistinguishable from a human at the keyboard.

**Dispatch:** Push — `tmux send-keys -l` types the literal bootstrap text into the chosen pane, then a separate `Enter` submits.

**Completion & review:** Completion rides the MCP `set_my_status` → Mongo write (trusted), with `capture-pane` parsing only as a fragile fallback for stuck/waiting detection. Per-card phone review is a stated weak point: a bare REPL is one long terminal session and does not naturally mint a per-card claude.ai URL, so review risks degrading to per-worker unless a `/clear`'d session exposes a fresh review URL (an unverified assumption).

**Billing argument:** Bets that typing into a bare interactive REPL bills to the subscription because the session is "interactive by nature." The doc flags this as the load-bearing, unverified assumption #1, owned by the billing-research agent.

**Strengths:**
- Workers stay warm — no per-card cold start.
- tmux gives free detach/persistence and re-adoption across runner restarts.
- Completion rides the already-built MCP/Mongo path.

**Risks:**
- Keystroke injection is stringly-typed and stateful — fragile to TUI repaints and prompt-state races; mis-fired keystrokes (into a y/N prompt or mid-`/clear`) are the single most dangerous failure.
- Per-card cwd rerooting and per-card review both push back toward relaunch-per-card, eroding the warm-pool benefit.
- The cleanest completion signal is identical to sol-2's, without the injection — raising whether send-keys earns its complexity.

**Verdict:** Autonomy ★★★★☆ / Billing-safety ★★★★☆ / Robustness ★★☆☆☆ / Build-effort ★★☆☆☆. Note: the synthesis applies a prior-art billing downgrade — a daemon-spawned `claude` is argued to be classified programmatic regardless of TUI rendering, casting doubt on the ★★★★ billing self-assessment.

## Candidate 2 — MCP pull-loop

See [brainstorm-execution-sol-2-mcp-pull.md](./brainstorm-execution-sol-2-mcp-pull.md).

**In one line:** Don't push tasks into sessions — let ~5 self-driving interactive sessions pull their own cards via a new queue-level MCP tool.

**How it works:** ~5 genuinely-interactive `claude` sessions are started once, by hand, each given a self-driving loop prompt (built on `/loop`). The session itself calls a new MCP tool `claim_next_task` to grab a card, works it, marks it `need_review`/`done`, runs `/clear`, then loops to claim the next. There is no external driver feeding the session — the only thing crossing the process boundary is a tool call the agent itself decides to make. A thin supervisor just keeps 5 alive and refills the queue.

**Dispatch:** Pull — no injection at all; the session invokes `claim_next_task()`, whose server side does the atomic Mongo claim and returns the card + workspace info.

**Completion & review:** Completion is the agent's own `set_my_status(cardId, ...)` call; the board never parses session output — it reads Mongo (the clean win). Per-card phone review takes a hit: one worker is one long claude.ai session URL spanning many cards, so there is no 1:1 card↔URL; review degrades to the `card_events` timeline plus the worktree diff, optionally a best-effort deep-link anchor.

**Billing argument:** Genuinely interactive, human-started once, with no SDK/headless path and no API key. Honestly flagged: −1 for the unverified assumption that a long interactive session that idles on an empty queue then resumes stays subscription-billed.

**Strengths:**
- Removes the injection channel — the single most billing-fragile, spike-dependent mechanism in the other candidates.
- State lives in Mongo + tool calls, not scraped stdout; the supervisor shrinks to "keep 5 alive + refill queue."
- Most of the old runner is deleted, not added.

**Risks:**
- Context hygiene is the single biggest open question — whether the loop body can self-issue `/clear` and whether it fully clears (vs. compacts); fallback is a per-card subtask or periodic recycle.
- A worker that hangs (not crashes) holding a card needs a lease TTL / stale-lease sweep, else the card never moves.
- Thundering claim on an empty queue wastes turns unless idle back-off is added.

**Verdict:** Autonomy ★★★★★ / Billing-safety ★★★★☆ / Robustness ★★★☆☆ / Build-effort ★★★★☆.

**UPDATE — verified + corrected (May 31):** `/loop` is a real slash command and *does* run unattended with no human between iterations — BUT it is **timer/interval-driven** (a fixed cron interval, or self-paced 1 min–1 hr), the **process must stay alive**, and **recurring loops auto-expire after 7 days** (a daemon must re-arm them). It is *not* "re-fires the instant the agent ends its turn," and the "Ralph Stop-hook re-feed" cited in prior-art is **not** in the official docs ([scheduled-tasks](https://code.claude.com/docs/en/scheduled-tasks)).

**Variant 2′ — human-driven reused session (preferred):** drop `/loop` entirely; the human runs `/clear` and kicks off the next card within one long reused session. No timer, no 7-day expiry, and **unambiguously subscription-billed** (every turn is a human-interactive action). This is the "one chat, many cards" idea, and the MCP server is exactly the *"local server claude connects to"* to pull each task. Its dispatch is the candidate-4 `/work-card <id>` skill below — so 2′ and 4 are really one design.

## Candidate 3 — pty-per-card

See [brainstorm-execution-sol-3-pty-per-card.md](./brainstorm-execution-sol-3-pty-per-card.md).

**In one line:** For each claimed card, spawn a brand-new interactive `claude` attached to a fresh pseudo-terminal (pty), let it run, then tear the pty down.

**How it works:** Don't reuse workers and don't go headless. The runner allocates a pty (via `node-pty`), launches a fresh interactive `claude` (no `-p`) attached to it with cwd set to the card's workspace, writes the bootstrap prompt to the pty master, lets it run to `need_review`/`done`, then reaps it. Up to 5 ptys live at once. The bet: a `claude` whose stdio is a real TTY is classified as interactive (subscription), whereas headless `claude -p` is programmatic. This keeps almost the entire locked design intact — only the launch shape changes.

**Dispatch:** Spawn-per-card — a single `pty.write(bootstrapPrompt + "\r")` at session start; `CARD_ID` is passed via env so the MCP server stays card-scoped.

**Completion & review:** Completion is layered: MCP status transition is authoritative, process exit (`pty.onExit`) is the natural per-card signal, output heuristics are last resort. Per-card review is the keystone advantage: one fresh session = one card = one reviewable claude.ai URL scraped from the pty stream and stored via `set_session_url`, with clean 1:1 mapping and zero "scroll past the previous card" problem.

**Billing argument:** Rides the documented interactive REPL — same argv as a human minus `-p`, on a real TTY — argued a more conservative bet than `--bg`. Entirely hinges on assumption A-1: billing keys on launch-mode + TTY, not human-presence heuristics. If A-1 is false it collapses into "headless with extra steps."

**Strengths:**
- Zero context bleed and no inter-card reset logic — fresh session per card.
- Per-card URL for free; process-exit = completion (simplest signal); crash recovery == normal start (one code path).
- Minimal delta to the locked scheduler/runner/data-model.

**Risks:**
- Hinges entirely on A-1 — if billing keys on human-presence, it is no better than `-p` (catastrophic for the cost goal).
- Per-card cold start every card (no warm pool); `node-pty` is a native build dependency per arch.
- TUI output parsing for the URL scrape is brittle against ANSI redraws and spinners.

**Verdict:** Autonomy ★★★★★ / Billing-safety ★★★☆☆ / Robustness ★★★★☆ / Build-effort ★★★★☆. Note: prior-art argues a daemon-spawned `claude` (even on a pty/TUI) may be classified programmatic, the same downgrade applied to sol-1.

**UPDATE — verified (May 31):** Yes, you *can* hand a fresh interactive session its task at launch — `claude "<prompt>"` (positional arg, no `-p`) starts an **interactive** session pre-seeded with that prompt and stays interactive, which is precisely the fresh-per-card pty launch (one initial prompt per session). Interactive mode keys off the *absence* of `-p`, not a TTY/human-presence heuristic in the docs; you can't feed *further* prompts to stdin after launch, but sol-3 never needs to ([cli-reference](https://code.claude.com/docs/en/cli-reference)). The A-1 billing bet (does a pty-launched `claude` bill as interactive?) is unchanged and remains the single real risk.

## Candidate 4 — Remote Control dispatch

See [brainstorm-execution-sol-4-remote-control.md](./brainstorm-execution-sol-4-remote-control.md).

**In one line:** The phone is the control plane — dispatch a card by handing it to a worker through the claude.ai Remote Control surface, reusing the channel the user already has.

**How it works:** Keep a pool of ~5 generic, card-agnostic Remote Control workers sitting idle. The board gains a dispatch lane: the user taps a Todo card, then taps a free worker. That tap hits a board Server Action that atomically claims the card in Mongo, stamps the worker, prepares worktrees locally (zero Claude tokens), and deep-links the user into that worker's Remote Control chat with a pre-filled prompt. The user presses send — that send is the interactive, subscription-billed event. A conditional variant (b) would deliver the message programmatically, but only if a remote message API exists AND its billing is confirmed.

**Dispatch:** Human-in-loop by default (variant a) — a phone tap claims and routes; the human pressing send is the dispatch. Variant (b) would be programmatic but is gated on two unverified unknowns (U1, U1b) and is not to be built speculatively.

**Completion & review:** Completion is the worker's `set_my_status(done)` via the existing card-scoped MCP. Per-card review is the approach's natural strength: the board is already the phone surface and now also the dispatch surface, and a `need_review` session stays alive so the user steers it in the very session that did the work. Caveat: a reused worker spans many cards under one session URL, eroding the per-card-URL keystone unless per-card anchors are stored.

**Billing argument:** Variant (a) is billing-safe by construction and needs zero empirical verification — the dispatch is literally a human pressing send, and execution is plain interactive Claude Code with no `-p`, SDK, or headless anywhere. (Variant b reintroduces the exact billing ambiguity the brainstorm exists to avoid.)

**Strengths:**
- Variant (a) needs no empirical billing verification.
- Reuses the surface the user already has — no new injection mechanism, no tmux/pty/MCP-refactor.
- Review and dispatch coexist on one phone screen; keep-alive through review means no re-attach needed.

**Risks:**
- Not autonomous in the unattended sense — the human is the trigger; nobody taps, nothing runs (the autonomy cost made literal, its biggest drawback).
- Reused-worker context hygiene depends on `/clear` working reliably through Remote Control (U4); leakage falls back to per-card respawn.
- No re-attach (U3) means crash recovery always re-dispatches fresh; taps to a sleeping Mac silently queue.

**Verdict:** Autonomy ★★☆☆☆ (★★★★☆ only if variant b verifies) / Billing-safety ★★★★★ / Robustness ★★★☆☆ / Build-effort ★★★★☆.

**UPDATE — reworked (May 31): the deep-link was false.** Remote Control has **no** documented deep-link-with-pre-filled-prompt and **no** programmatic message API — you get a per-session URL/QR but are dropped into a chat UI to type yourself ([remote-control](https://code.claude.com/docs/en/remote-control)). So variant (b) is dead. **Replacement (user's idea, verified feasible):** define a custom skill `/work-card <id>` (`.claude/skills/work-card/SKILL.md`, with `arguments`); from the mobile Remote Control view the user types `/work-card 42` with the card id copied from the board, and the skill calls our MCP tools to claim/fetch the task, set up the worktree, and work it. Slash commands pass through Remote Control, and typing one is a human-interactive action → **billing-safe** ([skills](https://code.claude.com/docs/en/skills)). This *is* the dispatch mechanism for the **2′ reused session** — candidate 4 collapses into 2′.

## Candidate 5 — Channels webhook

See [brainstorm-execution-sol-5-channels.md](./brainstorm-execution-sol-5-channels.md).

**UPDATE — ❌ NO-GO (May 31, user):** Billing class is undocumented (channels work with an API key too, so "uses a channel" ≠ subscription-billed), plus research-preview/dev-flag status and a Team admin toggle. The user's intended shape — *"a local running server that claude connects to"* — is actually the **candidate-2 MCP** model (claude as the MCP client pulling work), not a channel pushing messages in. Dropped.

**In one line:** Keep ~5 human-started interactive sessions, each with a custom webhook Channel attached, and dispatch a card by POSTing it to the chosen worker's local channel port.

**How it works:** Each of ~5 slots is a `claude` session the user starts once interactively (claude.ai auth, `ANTHROPIC_API_KEY` unset), launched with a custom development channel that opens a local HTTP port (e.g. `127.0.0.1:8801`). The runner claims a card, picks a free slot, and POSTs the task to that slot's port; the channel server forwards it as a `<channel>` event inside the live session, which auto-triggers a turn — Claude reads it, cds into the card workspace, and works it. Channels are a documented, sanctioned mechanism (the same way Telegram/iMessage feed a session); no daemon spawns `claude`.

**Dispatch:** Push via webhook channel — an HTTP POST to the slot's local port; the inbound channel event auto-acts (no human ack, no keystrokes).

**Completion & review:** Primary completion is MCP `set_my_status` (board is truth); the two-way channel `reply` is an additive faster secondary signal, beating output-parsing. Per-card review is the weakest point: a pool worker is not a per-card remote-control session, so there is no per-card claude.ai URL; review falls back to the channel/`card_events` timeline, or a hybrid that escalates a `need_review` card into a fresh per-card session.

**Billing argument:** More defensible than tmux/pty because the message is delivered into a session a human genuinely started interactively, via the official channel mechanism — no daemon spawns `claude`. Honestly flagged: docs never state the billing class, and a runner POSTing 24/7 into 5 sessions could read as the metered-automation pattern the split targets — the core unresolved risk.

**Strengths:**
- Best-of-breed billing argument: official push into a human-started interactive subscription session, no daemon-spawned `claude`.
- Auto-acts on inbound — fully autonomous dispatch after the one-time launch.
- Structured events + two-way `reply` ack beat TUI output-parsing.

**Risks:**
- Billing class is undocumented and 24/7 push may read as the metered-automation pattern (the core unresolved risk).
- Research-preview / dev-flag status (`--dangerously-load-development-channels`); protocol may change and Team orgs must enable `channelsEnabled`.
- Reused-worker context hygiene and fire-and-forget silent-drop delivery add fragility.

**Verdict:** Autonomy ★★★★☆ / Billing-safety ★★★☆☆ / Robustness ★★★☆☆ / Build-effort ★★★☆☆.
