# Synthesis — execution architecture, billing-constrained

> Zoom-back-in step for [brainstorm-execution-billing.md](./brainstorm-execution-billing.md). Compares the five candidates ([sol-1](./brainstorm-execution-sol-1-tmux-pool.md) · [sol-2](./brainstorm-execution-sol-2-mcp-pull.md) · [sol-3](./brainstorm-execution-sol-3-pty-per-card.md) · [sol-4](./brainstorm-execution-sol-4-remote-control.md) · [sol-5](./brainstorm-execution-sol-5-channels.md)) against the [prior-art](./brainstorm-execution-prior-art.md), and recommends a staged path.

## The constraint (recap)

Per-card sessions **must bill on the Team Premium subscription** (interactive), not the post-June-15 metered Agent-SDK/headless pool. Pool ~5. Lean reused workers.

## Scorecard (each agent's self-verdict; billing adjusted for prior-art)

| # | Approach | Autonomy | Billing-safety | Robustness | Build | Per-card review |
| - | -------- | :------: | :------------: | :--------: | :---: | --------------- |
| 1 | tmux/expect pool | ★★★★ | ★★★★→**★★** | ★★ | ★★ | ✗ (reused) |
| 2 | MCP pull-loop | ★★★★★ | ★★★★ | ★★★ | ★★★★ | ✗ (reused) |
| 3 | pty per-card | ★★★★★ | ★★★ | ★★★★ | ★★★★ | ✓ (1:1 URL) |
| 4 | Remote Control (a) | ★★ | ★★★★★ | ★★★ | ★★★★ | ✓ (phone-native) |
| 5 | Channels webhook | ★★★★ | ★★★ | ★★★ | ★★★ | ✗ (reused) |

_Billing arrow on sol-1: the agent rated ★★★★ before prior-art; prior-art argues a daemon faking interactivity (send-keys) likely does **not** bill as subscription and is ToS-gray → downgraded._

## The one finding that dominates everything

**Anthropic is *deliberately* metering automated throughput** (that's what the June-15 split is *for*). The prior-art's sharpest line: a runner POSTing tasks 24/7 into 5 sessions "is exactly the automated-throughput pattern the split is meant to meter." So:

> The closer a design gets to **fully autonomous, high-throughput, subscription-billed**, the deeper it sits in the **metered-or-ToS-gray** zone. The only candidate that is *unambiguously* subscription-billed (sol-4) is the one that keeps a **human genuinely in the dispatch loop**.

This is a real trilemma — pick at most two of {full autonomy, subscription-billed, clearly-within-ToS}. The decision is **where on that spectrum the user wants to sit**, not which clever mechanism wins.

## Cross-cutting observations

1. **Per-card phone review (a locked keystone) only survives in a fresh-session-per-card model** (sol-3, and sol-4 if it respawns). Every reused-pool design (1/2/5, reused sol-4) collapses many cards into one session URL → review degrades to the `card_events` timeline + worktree diff. Whether that's acceptable is a **product decision**.
2. **Context hygiene between cards** is the shared Achilles' heel of every reused-worker design — whether `/clear` *actually resets* vs. merely compacts. Fresh-per-card (sol-3) sidesteps it entirely.
3. **There is a dispatch-agnostic substrate common to all five**: the atomic Mongo claim (`todo→in_progress`), the WIP=5 cap, the worker/slot registry, per-card worktree prep, and MCP `set_my_status`-driven completion (read from Mongo, not stdout-scraped). None of it spawns Claude → **zero billing risk** → buildable *now*, and it's exactly the already-recommended "reconcile-and-claim" first slice.
4. **Dispatch belongs behind an adapter seam** (sol-4 named it `deliverMessage`). Swapping human-tap ↔ channel-POST ↔ pty-spawn becomes a one-adapter change, so we don't bet the architecture on an unverified billing class.
5. **Completion should be MCP→Mongo for all of them** — sol-2's cleanest insight. It removes the fragile output-parsing that drags down sol-1.

## Recommendation — stage it, decide dispatch last

**Slice A (build now, billing-risk-free):** the dispatch-agnostic substrate — atomic claim + WIP=5 + worker/slot registry + worktree prep + MCP completion + audit events, behind a `deliverMessage` adapter. Valuable under *every* candidate; commits to nothing.

**Slice B (ship the safe dispatcher):** wire the adapter to **sol-4 variant (a), human-in-loop Remote Control** — the only *definitively* subscription-billed path, works **today**, and is phone-native (review + dispatch on one surface). Semi-autonomous: you tap to dispatch, the agent executes. This is a usable product immediately.

**Slice C (graduate autonomy *iff* billing permits):** empirically probe the billing class of the auto-dispatch mechanisms — **sol-2 (MCP-pull)** and **sol-3 (pty-per-card)** are the front-runners (highest autonomy; sol-3 also keeps per-card review). Flip the adapter to whichever the billing evidence clears. Do the probe *after June 15* so it reflects the final billing model.

Net: we get a working, billing-safe product now (sol-4a), keep full autonomy as a drop-in upgrade (sol-2/sol-3) gated on evidence, and never block on the unverifiable.

## Open product decisions for the user

- **A. Where on the trilemma?** Ship safe-but-semi-autonomous now (sol-4a), or hold out for full autonomy and accept billing risk / a wait?
- **B. Is per-card phone review a hard keystone**, or is a `card_events` timeline + diff an acceptable substitute for reused-worker designs?
- **C. Build Slice A now?** (It's safe and useful regardless of B/C dispatch choice.)
