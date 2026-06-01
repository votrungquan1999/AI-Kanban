# Brainstorm — Subscription-billed execution architecture

> Driven by a billing constraint discovered in [research](../research/README.md). This brainstorm reconsiders **how card sessions execute**, because the originally locked "Claude Agent SDK TS" execution mechanism conflicts with a hard cost requirement. Parent: [design README](../design/README.md). Sibling solution files will be split out as the brainstorm progresses (see [Solution dimensions](#solution-dimensions)).

## Problem statement

**The autonomous loop's per-card Claude sessions MUST bill against the user's Team Premium subscription (interactive Claude Code usage), NOT the post-June-15 metered Agent SDK / headless credit pool.**

Why this is a hard constraint, not a preference:

- As of **June 15, 2026**, Anthropic splits billing: **interactive** Claude Code (terminal/IDE) stays on the subscription; **programmatic** usage (Agent SDK, `claude -p` headless, GitHub Actions) moves to a **separate monthly credit pool** (~$100/mo for Team Premium / Max 5x) consumed at **full API rates, no rollover**, then pay-as-you-go.
- At this project's token appetite, **$100/mo of metered credit is not enough** — it would drain in a few hundred cards then bill API rates. The user needs the subscription's (much larger, flat) interactive allowance. So "runs on the subscription" is a **must-have**.
- We **cannot wait until June 15 to empirically test** which pool `claude --bg` draws from, and a pre-June-15 test would measure a model that's about to change anyway. We need an approach that is **interactive by nature** so it is robust to the split.

### What this rules out

- **Agent SDK (TS)** as the card-execution driver — it is precisely what moves to the metered pool. This **conflicts with the locked stack decision** ("Claude Agent SDK TS") in the [design README](../design/README.md) and must be revisited.
- **`claude -p` headless** — same metered classification.
- **`claude --bg` background agents** — billing classification is **undocumented / gray-zone**; may flip on June 15. Cannot be relied on without evidence.

### What must be preserved (keystone, still locked)

- **Local-first**: sessions operate on the user's **local git repos** (worktrees under `workspaces/`, branch `aikanban/card-N`). See [design README](../design/README.md).
- **Per-card phone review**: each card's work is **individually reviewable on the phone** (claude.ai Remote Control).
- The Mongo data model + audit log ([data-model](../design/data-model.md)) and the reconcile/WIP-claim loop ([scheduler-runner](../design/scheduler-runner.md)) stay.

## Seed idea (from the user)

> "Keep a **pool of long-running [interactive] sessions** on my machine, talk to them through the **remote** feature, then have a **claim mechanism** so the pool sessions don't step on each other."

This is the promising direction: long-lived **genuinely-interactive** sessions are the one execution mode documented as subscription-billed. The open questions it raises:

1. **Injection channel** — how does an *automated* runner feed a task into a running interactive session without that injection itself counting as "programmatic"? (Candidates to research: claude.ai Remote Control message injection, tmux `send-keys`, `expect`, IDE attach. TBD.)
2. **Claim / mutual-exclusion** — how do pool workers atomically claim a card so two never grab the same one (the Mongo `findOneAndUpdate` claim already drafted).
3. **Context hygiene** — a reused worker carries prior-card context; how is it reset between cards (`/clear`, new conversation) so cards don't leak into each other.
4. **Reviewability** — a *reused* worker is one long session; does each card still get an individually-reviewable surface, or does review become per-worker?

## Solution dimensions (to explore)

The brainstorm will zoom out across these axes before zooming into a design. Each gets its own solution file once we generate alternatives:

- **Execution unit**: reused worker pool ↔ ephemeral-but-interactive session per card.
- **Dispatch**: fully-automated injection ↔ human-in-loop (phone tap assigns a worker).
- **Injection mechanism**: Remote Control ↔ terminal-multiplexer driving ↔ other.
- **Isolation**: per-worker worktree ↔ per-card worktree.
- **Concurrency**: fixed pool size N vs. dynamic.

## Clarifying questions (answers folded in)

- **Dispatch mechanism** — *don't pick one yet; explore multiple.* The user wants the dispatch/injection axis **fanned out** into several candidate solutions.
- **Concurrency** — **~5** concurrent card sessions (pool size / WIP limit).
- **Session lifecycle** — **explore both**, **leaning to reused long-lived workers** (seed idea); include fresh-interactive-per-card if a feasible variant exists.

## Candidate solutions (fanned out — one file each)

Generated in parallel, one investigation agent per distinct execution/dispatch mechanism. Quantity-first per the brainstorming rules; criticism/synthesis happens after all return + prior-art lands. **For a plain-language, skimmable summary of all five (grounded in the docs below), read [brainstorm-execution-overview.md](./brainstorm-execution-overview.md); the full comparison + recommendation is in [brainstorm-execution-synthesis.md](./brainstorm-execution-synthesis.md).**

| # | Approach | Dispatch | Session model | File |
| - | -------- | -------- | ------------- | ---- |
| 1 | tmux/expect terminal-driving of a persistent worker pool | push (inject keystrokes) | reused | [sol-1](./brainstorm-execution-sol-1-tmux-pool.md) |
| 2 | MCP pull-loop — interactive sessions self-pull next card | pull (no injection) | reused | [sol-2](./brainstorm-execution-sol-2-mcp-pull.md) |
| 3 | Fresh interactive session per card via a pty/TTY harness | spawn-per-card | ephemeral-interactive | [sol-3](./brainstorm-execution-sol-3-pty-per-card.md) |
| 4 | Remote Control / phone-mediated dispatch | human-in-loop (+ any programmatic remote angle) | either | [sol-4](./brainstorm-execution-sol-4-remote-control.md) |
| 5 | **Channels webhook** — POST a task into a live interactive session (sanctioned push) | push via webhook channel | reused | [sol-5](./brainstorm-execution-sol-5-channels.md) |

## Live decisions & verified facts (May 31)

Reviewing the [overview](./brainstorm-execution-overview.md) with the user, plus a round of doc verification, pruned and corrected the field:

- **❌ Candidate 1 (tmux) — dropped.** Dominated by sol-2/sol-3 (same MCP→Mongo completion, no keystroke injection) and billing/ToS-gray.
- **❌ Candidate 5 (channels) — no-go.** Billing class undocumented (works with an API key too), research-preview + Team admin toggle. The user's "local server claude connects to" is the candidate-2 MCP model, not a pushing channel.
- **✅ Candidate 2 — kept, corrected.** `/loop` runs unattended but is timer-driven + 7-day-expiry + process-must-stay-alive ([scheduled-tasks](https://code.claude.com/docs/en/scheduled-tasks)); no documented Ralph re-feed. Preferred shape is **variant 2′**: a human-driven reused session (`/clear` + next card), unambiguously subscription-billed.
- **🔁 Candidate 4 — reworked.** Remote Control deep-link/pre-fill is **not real** ([remote-control](https://code.claude.com/docs/en/remote-control)); replaced by a verified **`/work-card <id>` skill** the user types from mobile (card id copied from the board), which calls MCP to work the card ([skills](https://code.claude.com/docs/en/skills)). This merges into 2′ as its dispatch.
- **✅ Candidate 3 — kept, verified.** `claude "<prompt>"` (no `-p`) launches an interactive session seeded with the prompt — works for a fresh-per-card pty ([cli-reference](https://code.claude.com/docs/en/cli-reference)). The A-1 billing bet remains the only real risk.

**Shortlist: 2′** (reused session + `/work-card` skill — billing-safe, semi-autonomous) **vs. 3** (pty per-card — fully autonomous, billing bet). Staged path: ship 2′ now; add 3 as the autonomous upgrade if its billing clears post-June-15.

## Prior art / how others approach this

Landed: [brainstorm-execution-prior-art.md](./brainstorm-execution-prior-art.md). The findings that **reshape the candidate field**:

- **Billing is classified by the invocation surface, not by appearance.** Making a daemon-spawned `claude` merely *look* interactive (pty/TUI) likely does **not** move it onto the subscription, and is argued to be a **ToS risk**. → casts real doubt on **sol-1 (tmux)** and **sol-3 (pty)** as "billing-safe."
- **Remote Control = subscription-billed but human-only** (rejects API keys; no programmatic injection API). → **sol-4 variant (b) is likely a dead end**; variant (a) human-dispatch stands.
- **Channels (custom webhook channel)** = the one *sanctioned* way to push a message into a live interactive session on subscription auth. → promoted to its own candidate **sol-5** (added after prior-art).
- **Ralph Loop "Stop-hook re-feed"** = a sanctioned in-session loop (no headless). → the likely engine for **sol-2 (MCP-pull)**'s self-sustaining loop.
- Closest community shapes: **claude-squad** (interactive + tmux + worktree-per-session, human-initiated), **claude_code_agent_farm** (20–50 tmux agents with lock-file claim), **claude-queue** (subscription-quota-aware, cookie-replay = gray-zone).
