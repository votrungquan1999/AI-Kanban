> Candidate #3 for [brainstorm-execution-billing.md](./brainstorm-execution-billing.md). Sibling candidates: sol-1 (tmux-pool), sol-2 (mcp-pull), sol-4 (remote-control).

# Candidate #3 — Fresh interactive `claude` per card under a pty harness

## One-paragraph thesis

Don't reuse workers and don't go headless. For **each claimed card**, the runner allocates a **pseudo-terminal (pty)**, launches a **brand-new genuinely-interactive `claude` session attached to that pty** (as if a human opened a terminal and typed `claude`), feeds it the bootstrap prompt by writing to the pty master, lets it run to `need_review`/`done`, then tears the pty down. Concurrency ~5 = up to 5 live ptys. The bet: a `claude` process whose stdin/stdout/stderr are a TTY is classified by Anthropic's billing as **interactive Claude Code** (on the subscription), whereas `claude -p` (headless, no TTY, one-shot) is **programmatic** (metered pool). This is the **load-bearing assumption** — see [Why pty ≠ headless](#why-pty--headless).

This approach keeps almost the entire existing design intact: the [reconcile/claim loop](../design/scheduler-runner.md), the per-card worktree model, the Mongo data model, and the MCP card-scoping. It only swaps the **launch shape** of the per-card process from `claude --bg` / Remote Control to `claude` on a pty.

---

## Topology

```
 ┌─ user's Mac (awake, caffeinated, subscription OAuth in env) ─────────┐
 │  runner (Node, in-process with scheduler)                            │
 │   reconcile tick ──► atomicClaim() todo→in_progress (WIP cap 5)      │
 │     └─ per claimed card:                                             │
 │         pty = node-pty.spawn("claude", [..interactive flags..],      │
 │                    { cwd: workspaces/card-N, name:"xterm-256color",  │
 │                      cols:120, rows:40, env:{CARD_ID, OAUTH, ...} })  │
 │         pty.write(bootstrapPrompt + "\r")     # dispatch             │
 │         pty.onData(buf => ringBuffer.push(buf))  # capture stdout    │
 │         scrape claude.ai URL ► set_session_url(card,…)               │
 │         pty.onExit(code => onProcessExit(card, code))                │
 │   (≤5 ptys live at once)                                             │
 └──────────────────────────────────────────────────────────────────────┘
                 │ Mongo (Atlas M0)            │ each session = 1 claude.ai URL
                 ▼                             ▼
            cards collection            phone review (per card)
```

**Tooling for the pty.** Preference order:

1. **`node-pty`** (Microsoft, used by VS Code's integrated terminal). Native addon, gives a real `forkpty()` master/slave pair, `write()`, `onData`, `onExit`, resize. This is the right primitive because the runner is already Node/TS — no shelling out to a wrapper, structured events, robust on macOS. **Chosen default.**
2. `script -q /dev/null claude …` (BSD `script` on macOS) — allocates a TTY and runs the command under it; portable fallback if a native addon is undesirable, but stdin injection + exit-code capture is clumsier.
3. `unbuffer` (expectk) / `expect` — `unbuffer` forces a pty so output isn't block- buffered; full `expect` can also pattern-match prompts. Heavier, Tcl dependency.

We pick **node-pty**; `script`/`unbuffer` are documented fallbacks if node-pty's native build is a deployment headache on the target Mac.

**stdout capture for completion detection.** `pty.onData` streams every byte the session would have painted to a terminal (including ANSI escapes). The runner appends to a bounded **ring buffer** per card and runs two scrapers over it: (a) the **session-URL regex** `https:\/\/claude\.ai\/code\/\S+` to capture the review link (same Spike #1 scrape the current design already plans), and (b) optional liveness/idle heuristics. We **strip ANSI** before regex matching. Completion itself is primarily a **process-exit** signal, not output parsing — see [Completion detection](#completion-detection).

---

## Why pty ≠ headless

This is the **central, load-bearing assumption.** A sibling agent researches the actual billing classification; here we articulate *why it is plausible* and *what we are betting on*, so the design can be validated or discarded cleanly.

**The claimed distinction.** Anthropic's June-15 split is "interactive Claude Code (terminal/IDE) stays on subscription; programmatic (Agent SDK, `claude -p` headless, GitHub Actions) moves to the metered pool." The observable thing that most cleanly separates the two at process-launch time is **whether the process runs attached to a controlling terminal (a TTY)**:

- `claude` with no `-p`, launched from a shell on a TTY → enters its **interactive REPL / TUI** (the Ink-based terminal UI). It reads from stdin as a terminal, renders a live UI, stays alive for a conversation. This is the "human at a terminal" mode.
- `claude -p "<prompt>"` → **print/headless** mode: no TUI, reads the prompt, streams a result, exits. Explicitly the "programmatic" entry point Anthropic names.

**What makes our launch interactive.** We launch the **same interactive entry point** a human uses — `claude` with **no `-p`** — and we give it a **real pty** so `isatty(0/1/2)` is true and the TUI initializes normally. From `claude`'s own perspective there is no difference between our pty and a human's terminal: same argv, same TTY semantics, same REPL. The runner is the "hands" typing into it, but the *session classification* is decided by the launch mode + TTY, not by who is typing.

**What we are explicitly betting on (assumptions-to-verify):**

- **A-1 (core):** Billing classification keys on **launch mode (`-p` vs interactive REPL) + TTY presence**, NOT on detecting a human (keystroke timing, focus, heuristics). If Anthropic fingerprints "is a human actually here," a pty alone won't fool it.
- **A-2:** A subscription-OAuth `claude` interactive session run **unattended** (no human ever in the loop) is still billed to the subscription — i.e. they don't gate interactive billing on interactivity *signals*, only on the *mode*.
- **A-3:** Programmatic `pty.write()` injection of the prompt does not itself re-classify the session as programmatic (it looks like typed keystrokes on the TTY).

If A-1 is **false**, this approach collapses into "headless with extra steps" and bills the metered pool — same failure as `claude -p`. **This must be verified before build.**

---

## Dispatch (feeding the initial prompt)

A fresh interactive REPL is waiting for input on its pty slave. The runner **writes the bootstrap prompt to the pty master**:

```ts
pty.write(bootstrapPrompt);
pty.write("\r");   // submit (carriage return = Enter in a TTY)
```

- The bootstrap prompt is the existing **generic, resume-aware prompt + prohibition list** ([bootstrap-prompt.md](../design/bootstrap-prompt.md)) — unchanged. It tells the agent to `get_my_task()`, discover/confirm repos, work, then `set_my_status`.
- **No per-card content injection beyond the one bootstrap message.** The board is the task queue; `CARD_ID` is passed via env so the MCP server is card-scoped. So dispatch is a single write at session start — minimal surface for "programmatic injection" concerns.
- **Multi-line / paste safety:** the TUI may interpret newlines mid-prompt as submit. Send the prompt as **one line** (or use the TUI's paste/bracketed-paste sequence) then a single `\r`. This is a small Spike (see failure modes).

---

## Claim mechanism & capping ptys at 5

Reuse the existing [atomic pickup](../design/scheduler-runner.md#atomic-pickup) unchanged — `findOneAndUpdate(todo→in_progress)` is single-doc atomic, so no two ticks claim the same card. The pty cap is enforced **the same way the current design enforces WIP**: by the runner counting live children, not by any `--capacity` flag.

```
tick():
  reconcile in-flight (crash recovery) as today
  live = count(ptys currently open in this runner)      # in-memory map cardId→pty
  headroom = WIP_LIMIT(=5) - count(cards status==in_progress)
  while headroom-- > 0:
     card = atomicClaim(); if !card break
     pty  = spawnInteractiveClaude(card)                 # allocate pty #N
     ptys.set(card._id, pty)
```

- **WIP=5 is the pool size**, but unlike sol-1/sol-2 there is **no pre-warmed pool** — ptys are allocated on demand and freed on card completion. "Pool of 5" here means "at most 5 ptys open," a pure concurrency cap.
- The `in_progress` **count in Mongo** is the durable cap (survives runner restart); the **in-memory `ptys` map** is the live handle set. On runner restart the map is empty but Mongo still shows `in_progress` cards with dead pids → the reconcile loop restarts them (one fresh pty each), naturally re-converging to ≤5.

---

## Worktree isolation

**Unchanged and clean.** Each card already gets its own `workspaces/card-<number>/` with a git worktree per chosen repo on branch `aikanban/card-<number>` ([data-model](../design/data-model.md), mcp-api-contract `add_repo_to_workspace`). The pty session's **`cwd` is that workspace dir**. Because **every card gets its own fresh session**, there is **zero cross-card context bleed** — no `/clear` dance, no risk of a reused worker carrying repo A's state into repo B's card. This is strictly cleaner than the reused-worker candidates (sol-1, sol-2), which must actively reset context between cards. Per-card session ↔ per-card worktree is a 1:1 mapping with no shared mutable state.

---

## Completion detection

The **fresh-session-per-card model makes process exit the natural completion signal** — this is a real advantage over reused workers (where a worker never exits between cards, so completion must be inferred from output/MCP).

Layered detection, primary → fallback:

1. **MCP status transition (authoritative).** The agent calls `set_my_status(done)` or `set_my_status(need_review)` via the card-scoped MCP server. The runner observes the resulting `cards` doc change (it already owns the DB). This is the **source of truth** for *board* state — same as the current design.
2. **Process exit (`pty.onExit`).** A fresh interactive session, told "finish the card then you're done," can be made to **exit the REPL** when work is complete (e.g. the bootstrap prompt instructs it to call `set_my_status` then `/exit`, or the runner sends `/exit`\r / Ctrl-D after observing the MCP `done`). Because the session is ephemeral, exit is expected and clean — not a crash. `onExit(code)` maps to:
   - card status `done` → `runState=exited`, reap, schedule worktree cleanup.
   - card status in-flight + unexpected exit → dirty death → next tick `recover()`.
3. **Output heuristics (last resort).** Idle-detection on the ring buffer (no `onData` for `T` seconds while at a prompt) flags a possibly-stuck session for the circuit breaker. Not used for normal completion — too brittle against TUI redraws.

**Nuance vs. keep-alive.** The current design keeps the process **alive through `need_review`** so the phone can steer it. With an interactive pty session we can do the same: on `need_review` the session **stays open** (REPL alive, waiting), and a human reply arrives via the claude.ai URL (the session's own remote surface). The session only truly exits on `done`. So "process exit = done" holds; `need_review` = "alive and waiting," exactly the two-axis state already specified.

---

## Per-card phone reviewability (the keystone advantage)

**This is candidate #3's biggest win.** A fresh interactive session per card means **one conversation = one card = one reviewable claude.ai URL**, with no extra plumbing — the same property `claude --bg` gives, but via the interactive path we're betting is subscription-billed.

How the URL is captured and stored (reuses Spike #1 machinery):

- An interactive `claude` session that is **logged in to the subscription account** surfaces a **claude.ai session/remote URL** (the same surface the phone uses to view and steer a session). The runner scrapes it from the **pty output stream** (`pty.onData` → ANSI-stripped ring buffer → regex `https:\/\/claude\.ai\/code\/\S+`), then calls **`set_session_url(card, { id, url })`** (runner-only MCP tool — agent can't forge it). Stored on `card.session`.
- The phone opens the **board** (Vercel→Atlas, reachable while the Mac is awake to run), taps the card, and follows `card.session.url` to that card's individual conversation. Review/steer happens there; a reply moves the card `need_review → in_progress` and the still-open pty session continues.
- **1:1 cleanliness:** because sessions never get reused, a review URL **always** maps to exactly one card's full history — no "scroll past the previous card's conversation" problem that a reused-worker long session (sol-1/sol-2) suffers.

**Assumption A-4:** an *interactive* (non-`--bg`) `claude` session exposes a phone-reachable claude.ai URL the same way `--bg` does. If interactive sessions only expose a *local* TUI with no remote surface, reviewability would require pairing with Remote Control (sol-4) — verify what URL, if any, a plain interactive session emits.

---

## Compare to `claude --bg`

Both `--bg` and this pty approach give the **per-card session + per-card claude.ai URL** keystone. The difference is **billing risk**:

| | `claude --bg` (background agent) | pty-interactive (this) |
| - | - | - |
| Per-card session + URL | ✅ native | ✅ (assuming A-4) |
| Runs unattended | ✅ designed for it | ✅ (assuming A-2) |
| Local repos/worktrees | ✅ | ✅ |
| **Billing classification** | **gray-zone** — `--bg` is a *new* mode; Anthropic hasn't documented which pool it draws from post-June-15, and it's plausibly grouped with "programmatic/headless" since it's explicitly the unattended automation entry point | **bet on interactive** — it *is* the literal interactive REPL a human uses, same argv minus `-p`, on a real TTY |
| Build effort | lowest (one flag) | low-moderate (pty harness) |

**Is pty-interactive a safer billing bet than `--bg`?** Plausibly **yes**, *if A-1 holds.* `--bg`'s risk is that it's a **purpose-built automation feature** — exactly the category Anthropic is moving to metered billing, and a feature they could flip on June 15 with a one-line changelog. The pty approach instead **rides the interactive REPL** that Anthropic has *explicitly* committed to keeping on the subscription. The bet shifts from "hope `--bg` stays free" (an undocumented, automation-flavored mode) to "hope they classify by launch-mode+TTY, not by human-presence heuristics" (A-1). The latter is a **more conservative bet** because it leans on the *documented* interactive/programmatic boundary rather than an *undocumented* third mode. **But** if Anthropic adds human-presence fingerprinting specifically to stop pty automation, this becomes *less* safe than `--bg` (which they might tacitly permit). Net: pty is the better bet on *current documented semantics*; `--bg` is the better bet if Anthropic is friendly to unattended automation in practice. Neither is verifiable pre-June-15 — see prior-art.

---

## Crash/restart, machine sleep, auth

- **Crash recovery — unchanged & even cleaner.** The [reconcile loop's invariant #2](../design/scheduler-runner.md#the-reconcile-tick) restarts any in-flight card whose pid is dead. A fresh pty session resumes from the board task + surviving worktree changes (chat transcript lost, file changes persist on the `aikanban/card-N` branch). Since *every* start is already a fresh session, crash recovery and normal start are **literally the same code path** — no "re-attach" special case (there is none; Spike #1). Circuit breaker (`MAX_RESTARTS`, backoff via `nextStartAfter`) applies as specified.
- **Runner restart.** Children spawned detached + pids persisted, so a runner restart doesn't kill live ptys; next tick re-adopts alive pids / restarts dead ones. (node-pty children: ensure `detached`/own process group so they survive parent exit, or accept that they die and rely on reconcile to restart — decide in Spike.)
- **Machine sleep.** Same tolerance as the whole design: the Mac must be **awake to run** (launchd LaunchAgent under `caffeinate -is`). Sleep pauses all ptys; on wake, sessions may be stale/disconnected → treat as dirty death → reconcile restarts. The board (cloud Atlas + Vercel) stays reachable for review while asleep; only *new execution* needs wakefulness.
- **Auth (unattended subscription OAuth).** The session must authenticate as the **subscription**, not via `ANTHROPIC_API_KEY` (which forces API billing). So: **`ANTHROPIC_API_KEY` MUST be unset** in the spawn env; supply **`CLAUDE_CODE_OAUTH_TOKEN`** (subscription OAuth) instead. The interactive browser- OAuth login won't re-prompt for a daemon, so the long-lived OAuth token must be provisioned once and refreshed. **Assumption A-5:** a long-lived subscription OAuth token usable headlessly-but-interactive-mode exists and stays valid for a launchd daemon (this is open question #2 in [research](../research/README.md), shared by all candidates).

---

## Tradeoffs / principles / priorities

**Principles.** (1) Change as little of the locked design as possible — only the *launch shape* moves. (2) Prefer the *documented* interactive boundary over the *undocumented* `--bg` boundary. (3) Statelessness per card (fresh session) over pooled reuse — buys clean isolation + free crash recovery at the cost of per-card startup.

**Priorities:** billing-safety > reviewability > robustness > build-effort.

**Pros**
- **Billing bet on the documented interactive path**, not undocumented `--bg`.
- **Per-card URL for free** — keystone reviewability, 1:1 clean.
- **Zero context bleed**, no inter-card reset logic (vs. sol-1/sol-2).
- **Process-exit = completion**, the simplest possible signal.
- **Crash recovery == normal start** — one code path.
- **Minimal delta** to scheduler/runner/data-model.

**Cons / tradeoffs**
- **Per-card cold start** every card (no warm pool) — startup + model context-load cost paid 5× more often than a reused pool. At ~dozens of cards/day this is fine.
- **node-pty native addon** is a deployment dependency (build per arch); fallback to `script`/`unbuffer` adds complexity.
- **TUI output parsing is brittle** — ANSI redraws, spinners. We minimize reliance on it (MCP + exit are primary).
- **Hinges entirely on A-1** — if billing keys on human-presence, no better than `-p`.

---

## Assumptions-to-verify (consolidated)

- **A-1 (core, blocking):** Billing keys on launch-mode (`-p` vs interactive) + TTY, not human-presence heuristics. *Sibling billing agent must confirm.*
- **A-2:** Unattended interactive session still bills to subscription.
- **A-3:** `pty.write()` prompt injection doesn't re-classify as programmatic.
- **A-4:** A plain interactive session exposes a phone-reachable claude.ai URL (like `--bg` does). If not → pair with Remote Control (sol-4) for the review surface.
- **A-5:** Long-lived subscription OAuth (`CLAUDE_CODE_OAUTH_TOKEN`) works for an unattended launchd daemon (shared open question across all candidates).
- **A-6:** node-pty builds/runs cleanly on the target Mac (else fallback tooling).

---

## Failure modes

- **A-1 false → metered billing.** Catastrophic for the cost goal; indistinguishable from `-p`. Mitigation: verify before build; cheap to test the *mechanism* pre-June-15 even if billing can't be tested.
- **Prompt-submit garbling.** Multi-line bootstrap prompt submitting early on a TTY. Mitigation: single-line/bracketed-paste + one `\r`; Spike it.
- **No URL emitted (A-4 false).** Review surface missing. Mitigation: fall back to Remote Control pairing (sol-4) or a local-only review.
- **Stuck session, never exits.** Mitigation: idle heuristic on ring buffer → circuit-breaker → flag on board; human kills via UI override.
- **OAuth token expiry mid-run.** Session fails to start/continue. Mitigation: token refresh + circuit breaker; surface `lastError` on the board.
- **node-pty build failure on deploy.** Mitigation: `script -q /dev/null claude …` fallback path.

---

## Verdict

| Dimension | Stars | Note |
| --------- | ----- | ---- |
| **Autonomy** | ★★★★★ | fully unattended; spawn-per-card needs no human in the loop |
| **Billing-safety** | ★★★☆☆ | rides the *documented* interactive path (better than `--bg`), but **entirely hinges on A-1**; unverifiable pre-June-15 |
| **Robustness** | ★★★★☆ | fresh-per-card → clean isolation + crash-recovery == normal-start; TUI parsing & node-pty are the soft spots |
| **Build-effort** | ★★★★☆ | small delta to the locked design — only the launch shape changes (pty harness + URL scrape) |
