> Part of [brainstorm-execution-billing.md](./brainstorm-execution-billing.md).

# Prior art — driving subscription-billed Claude Code for autonomous/fleet work

Research into how people run autonomous / pooled Claude Code workloads while trying to stay on the flat **interactive subscription** rather than the post-June-15 **metered Agent SDK credit pool**. Findings are tagged **[DOC]** (official docs), **[COMMUNITY]** (3rd-party claim/repo), or **[SPECULATION/GRAY]** (undocumented inference). All URLs in [Sources](#sources).

## TL;DR — the load-bearing fact

**[DOC]** Anthropic classifies billing by **invocation surface**, not by what the session "looks like." Interactive Claude Code in the terminal/IDE, claude.ai chat, and Cowork stay on the subscription. Programmatic = the **Agent SDK**, **`claude -p` non-interactive mode**, **Claude Code GitHub Actions**, and **third-party apps built on the Agent SDK** → separate monthly credit ($20 Pro / $100 Max 5x / $200 Max 20x), metered at full API rates, no rollover (support.claude.com 15036540; thenewstack; infoworld).

**[COMMUNITY, high-signal]** The clearest external reasoning on our exact question is multica-ai/multica issue #2815: *"any attempt by third-party tooling to make a programmatic client look interactive (or vice versa) for billing purposes is increasingly off-table — for ToS reasons and because Anthropic will keep tightening the classification."* It also notes a TUI-driven backend (PR #2813) **does not shift buckets**: "the daemon still spawns its own claude process, which Anthropic classifies as programmatic regardless of whether the binary renders a TUI or a stream-json stream." This is a community read, not an Anthropic statement, but it is the most direct analysis found.

Takeaway: an architecture that spawns its own `claude` process per task is at risk of programmatic classification **even if it renders a TUI**, if Anthropic keys classification on how the process was launched/authenticated. The genuinely-safe signal is a session a **human started interactively** with a **claude.ai OAuth login** — see areas 2 and 6.

---

## 1. Driving an interactive session programmatically (no SDK / no headless)

**The capability does not exist natively. [DOC]** anthropics/claude-code issue #27441 ("inter-agent message injection") requested a socket/pipe/HTTP endpoint to inject prompts into a *running* interactive session; it was **closed as duplicate** with no shipped API. There is no documented socket, FIFO, or API to push a prompt into a live `claude` REPL.

**Workarounds people use [COMMUNITY]:**

- **tmux `send-keys`** — the dominant technique. The "pmux" slash command injects via `tmux send-keys -l` (literal) + a ~0.3s delay + `C-m` to submit. claude_code_agent_farm spawns each agent as an interactive tmux pane and drives it the same way. This types characters into a *genuinely interactive* `claude` TUI exactly as a human keyboard would.
- **`expect`/`pexpect`, GNU `screen`, named pipes** — mentioned as equivalents; same idea (puppet the TTY of a real interactive process). No repo found that proves the billing class.

**Billing evidence: UNKNOWN / GRAY.** No official doc and no community post was found that empirically confirms tmux-driven keystrokes bill as interactive (subscription) vs programmatic. The hboon and other tmux guides discuss workflow only, **never billing**. The strongest adjacent claim (#2815) argues the *opposite*: classification follows how the process is launched/authenticated, so making a self-spawned process "look interactive" may not help. **Conclusion: interactive-session-driving via tmux/expect is a documented technique but its billing classification is UNDOCUMENTED, and there is community reasoning suggesting it may NOT be treated as interactive. Treat as gray-zone / ToS risk, not a confirmed escape.**

The one nuance that could matter: if a *human* launches `claude` (interactive, claude.ai OAuth) and tmux merely types into that already-interactive process, the billing surface is the interactive session — distinct from a daemon that itself runs `claude -p`. This is plausible but **unverified**.

## 2. claude.ai Remote Control

**[DOC]** (code.claude.com/docs/en/remote-control). Remote Control connects claude.ai/code or the Claude mobile app to a Claude Code session **running on your machine**. Start with `claude remote-control` (server mode), `claude --remote-control` (interactive + remote), or `/remote-control` from inside a session. Conversation stays in sync; you can send messages from terminal, browser, and phone interchangeably. Local process only makes **outbound HTTPS**; no inbound port.

Billing-relevant requirements **[DOC]**:
- **Requires a claude.ai subscription (Pro/Max/Team/Enterprise). "API keys are not supported."**
- **Inference-only tokens cannot establish Remote Control**: a `claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` login fails with *"Remote Control requires a full-scope login token"*; you must `claude auth login` with a full-scope claude.ai session token.

This strongly implies Remote Control sessions are part of the **interactive/subscription** surface (it is literally the steering layer for an interactive local session, and explicitly refuses the programmatic auth paths). **[DOC]** does not state billing class in those words, so it is **inference, not an explicit statement** — but it is well-supported.

**Programmatic message injection via Remote Control: NO documented path. [DOC]** The relay routes messages between **web/mobile clients** and the local session. There is no documented API, webhook, or SDK to POST a message into a Remote Control session — it is human-driven from claude.ai/code or the app. Server mode (`--spawn worktree`, `--capacity N`, default 32) can host many on-demand sessions each in its own worktree, but each is still **opened by a human client connecting**. So Remote Control gives us the *interactive billing surface* and *worktree isolation*, but **not** an automated injection channel.

## 3. Community pools / multi-session orchestrators

How each spawns sessions (interactive vs SDK/headless), isolation, claim mechanism, billing mentions:

- **smtg-ai/claude-squad** (~7.7k★) — Manages multiple AI terminal agents. **Interactive TUI in tmux**, **git worktree per session** (own branch). Sessions are **user-initiated via TUI** (press `n`); **no automated claim mechanism**. No billing mention. AGPL-3.0. Closest to our "interactive sessions in worktrees" shape.
- **Dicklesworthstone/claude_code_agent_farm** — Runs **20+ (up to 50) interactive Claude Code agents in tmux**, driven by **`send-keys`** with `ENABLE_BACKGROUND_TASKS=1 claude --dangerously-skip-permissions`. Coordination via **lock files** (`/coordination/`, `active_work_registry.json`, per-agent locks, stale-lock GC > 2h) — a real **claim/mutual- exclusion** pattern. Uses commits, **not** worktrees. No billing mention.
- **primeline-ai/claude-tmux-orchestration** — Spawns full AI sessions as parallel tmux workers; **heartbeat monitoring + file-based coordination**. tmux/interactive. No billing mention.
- **MatchaOnMuffins/orchestrator** — "Tmux for claude code"; **git worktree + branch per agent**, split-pane to watch agents side by side. tmux/interactive.
- **nielsgroen/claude-tmux** — tmux popup TUI for managing many Claude Code sessions, with worktree + PR support; **session lifecycle/switching**, not autonomous dispatch.
- **vasiliyk/claude-queue** — Task **queue** with priorities/dependencies; **monitors Claude Plan limits (5h + weekly), auto-pauses at 95%, resumes on reset.** Notably runs **headlessly** and reuses a **persistent session via a `sessionKey` cookie from claude.ai** (not `ANTHROPIC_API_KEY`) — i.e. it explicitly targets *plan* quotas, not API billing. The closest thing to a "subscription-billed worker pool," but cookie-replay is a **ToS gray-zone**.
- **anthropics/claude-code Agent Teams** (official, **[DOC]**) — Built-in coordination of multiple Claude Code instances as a team: shared tasks, inter-agent messaging, a pane per teammate. This is the **sanctioned** multi-session primitive; sessions are interactive panes you can click into. Worth evaluating as the blessed alternative to the community tmux orchestrators.

Pattern summary: **the community standard is interactive `claude` in tmux panes + git worktree-per-task + file/lock-based claim.** None document their billing class; all predate or ignore the June-15 split.

## 4. Long-lived worker / session-reuse patterns

- **`/clear` resets the conversation** to a fresh context (system prompt only) within the same running process **[DOC-ish/COMMUNITY]** — the canonical way to reset context between tasks on a reused worker. CLAUDE.md / auto-memory carry durable rules across clears.
- **"Spec/scratchpad file" relay [COMMUNITY]** — work accumulates to a file, session `/clear`s, next task reads the file. Decouples task-to-task continuity from conversation history; ideal for a worker that processes a queue.
- **Ralph Wiggum loop** (frankbria/ralph-claude-code; claude.com/plugins/ralph-loop) **[COMMUNITY + official plugin]** — Autonomous "run until done" loop. The **official Ralph Loop plugin** uses a **Stop hook**: it intercepts session exit and **re-feeds the prompt into the same session**, preserving files/git between iterations — an *in-session* re-prompt, no external injection needed. The community `frankbria` CLI instead **spawns fresh `claude` CLI processes per iteration** with session-file continuity + token/call caps. Two different shapes: hook-driven (in-session) vs process-per-iteration.
- **Stop / SessionEnd / UserPromptSubmit hooks** are the **sanctioned in-process automation surface** — they fire inside a running session and can mutate/append context. #27441's rejected ask was essentially "give us an *external* trigger like these hooks." The Ralph plugin shows hooks can drive a loop without `claude -p`.
- **vasiliyk/claude-queue** (above) is the most complete "queue → persistent session" worker, including limit-aware pause/resume.

For a worker pool: reuse N interactive sessions, `/clear` between cards, hand each card its context via a file/worktree, claim via lock/DB `findOneAndUpdate`. The open billing question (area 1) still gates whether the *injection* into those workers is interactive.

## 5. Background agents (`--bg` / `/bg`) and the June-15 split

**UNDOCUMENTED for billing. [GRAY]** No official doc found classifies `claude --bg` / `/bg` background agents as interactive vs programmatic, and none states whether June 15 changes them. claude_code_agent_farm uses `ENABLE_BACKGROUND_TASKS=1` (background *tasks* inside an interactive session) — different from a standalone background agent. The June-15 lists (support.claude.com 15036540) enumerate Agent SDK, `claude -p`, GitHub Actions, and third-party Agent-SDK apps; **background agents are not named either way.** The parent doc's caution stands: **do not rely on `--bg` billing class without evidence.**

## 6. Is there a sanctioned high-throughput-on-subscription path?

**Anthropic's intent appears to be: automation = metered.** The whole point of the split is to move programmatic/long-cycle usage (the "OpenClaw burning $1000s on a $200 plan" pattern, per the reporting) off the subscription. There is **no documented "interactive automation" escape hatch** that promises subscription billing for fully-autonomous work.

The **blessed event-driven primitives** that *do* run on a subscription-authed interactive session (all **[DOC]**, all require claude.ai auth, API key not supported for the subscription path):

- **Channels** (code.claude.com/docs/en/channels) — an MCP server that **pushes events into your already-running session** (Telegram/Discord/iMessage/**custom webhook**). Two-way chat bridge. **This is the one documented "push a message into a live interactive session" mechanism** — and a **custom webhook channel** is programmatically POST-able. Events arrive only while the session is open, so "run Claude in a background process or persistent terminal." Closest sanctioned analog to the seed idea's "inject a task into a pool session." **It does not state billing class**, but it runs in your interactive session on claude.ai auth, so it is the most defensible candidate. Note: it's reactive (needs an event), and a cron→webhook is explicitly called "a workaround, not native."
- **Remote Control** (area 2) — human steers the interactive session from phone/web.
- **Dispatch** (Cowork; claude.com/blog/dispatch-and-computer-use) — message a task from the phone; Claude spawns a **Desktop** session (dev work runs in Claude Code). Subscription (Max $200, Pro later). Human-triggered, not an API.
- **Scheduled tasks / routines** — timer-driven sessions on subscription auth.

**Honest read:** The sanctioned subscription-billed surfaces (Channels, Remote Control, Dispatch, scheduled tasks, Agent Teams) are all **human- or event-triggered interactive sessions**, not an automated-dispatch API. The closest fit for AI-Kanban is **Channels' custom webhook into a persistent interactive session** — programmatically POST-able, runs on subscription auth, official, two-way. Everything more automated than that drifts toward the metered/ToS-gray zone. The tmux `send-keys` route is technically viable but **billing- unverified and arguably against the ToS spirit** per #2815.

## Open questions to resolve before committing

1. Does a tmux-driven *human-started, claude.ai-OAuth* interactive session actually bill as interactive? (Empirically untested; #2815 suggests caution.) → consider a small controlled test once safe.
2. Can a **Channels custom webhook** reliably deliver per-card tasks into a pool of persistent interactive sessions, with `/clear` + worktree between cards? (Most promising sanctioned path.)
3. Is Agent Teams' inter-agent messaging usable as the claim/dispatch fabric on subscription billing?

## Sources

- Agent SDK with your Claude plan (Help Center): https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- The New Stack — Agent SDK credit pools: https://thenewstack.io/anthropic-agent-sdk-credits/
- InfoWorld — agents on a meter: https://www.infoworld.com/article/4171274/anthropic-puts-claude-agents-on-a-meter-across-its-subscriptions.html
- The Decoder — separate budgets for programmatic use: https://the-decoder.com/claude-subscriptions-get-separate-budgets-for-programmatic-use-billed-at-full-api-prices/
- VentureBeat — OpenClaw reinstated with a catch: https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch
- multica-ai/multica issue #2815 (programmatic-usage credit / daemon backend): https://github.com/multica-ai/multica/issues/2815
- anthropics/claude-code issue #27441 (inter-agent message injection): https://github.com/anthropics/claude-code/issues/27441
- Remote Control (docs): https://code.claude.com/docs/en/remote-control
- Channels (docs): https://code.claude.com/docs/en/channels
- Channels reference (build a webhook receiver): https://code.claude.com/docs/en/channels-reference
- Agent Teams (docs): https://code.claude.com/docs/en/agent-teams
- Dispatch (Cowork): https://claude.com/blog/dispatch-and-computer-use
- Dispatch from anywhere (Help Center): https://support.claude.com/en/articles/13947068-assign-tasks-to-claude-from-anywhere-in-cowork
- pmux tmux send-keys slash command: https://gist.github.com/GGPrompts/800f2c67d96bceab836c0090b71488ef
- Using tmux with Claude Code (hboon): https://hboon.com/using-tmux-with-claude-code/
- smtg-ai/claude-squad: https://github.com/smtg-ai/claude-squad
- Dicklesworthstone/claude_code_agent_farm: https://github.com/Dicklesworthstone/claude_code_agent_farm
- primeline-ai/claude-tmux-orchestration: https://github.com/primeline-ai/claude-tmux-orchestration
- MatchaOnMuffins/orchestrator: https://github.com/MatchaOnMuffins/orchestrator
- nielsgroen/claude-tmux: https://github.com/nielsgroen/claude-tmux
- vasiliyk/claude-queue: https://github.com/vasiliyk/claude-queue
- frankbria/ralph-claude-code: https://github.com/frankbria/ralph-claude-code
- Ralph Loop plugin (official): https://claude.com/plugins/ralph-loop
- Ralph Wiggum technique (Cyrus): https://www.atcyrus.com/stories/ralph-wiggum-technique-claude-code-autonomous-loops
- Agent SDK Max-plan billing request (issue #559): https://github.com/anthropics/claude-agent-sdk-python/issues/559
