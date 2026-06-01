# ADR 0001 — Execution architecture: reused-session dispatch now (2′), pty-per-card later (3)

- **Status:** Accepted — 2026-05-31
- **Deciders:** project owner
- **Context source:** the execution-architecture brainstorm ([billing/constraint](../brainstorm/brainstorm-execution-billing.md) · [overview of candidates](../brainstorm/brainstorm-execution-overview.md) · [synthesis](../brainstorm/brainstorm-execution-synthesis.md) · [prior-art](../brainstorm/brainstorm-execution-prior-art.md))
- **Supersedes:** the previously-locked "Claude Agent SDK TS" execution mechanism named in the [design README](../design/README.md) (see Decision → it is invalidated by the billing constraint).

## Context

The autonomous loop runs one Claude session per card on the user's local git repos. A billing constraint surfaced during research forces a rethink of *how* those sessions are spawned and driven.

- **Hard constraint:** per-card sessions **must bill against the Team Premium subscription** (interactive Claude Code), **not** the post-June-15-2026 metered Agent-SDK/headless credit pool (~$100/mo at full API rates, no rollover — too small for this project's token appetite). "Runs on the subscription" is a must-have, not a preference.
- **Consequence for the old plan:** the Agent SDK and `claude -p` headless are exactly what move to the metered pool, so the locked "Claude Agent SDK TS" execution mechanism can no longer drive card sessions.
- **The trilemma:** Anthropic is *deliberately* metering automated throughput, so a design can have at most two of {full autonomy, subscription-billed, clearly-within-ToS}. The decision is where on that spectrum to sit, not which clever mechanism wins.
- **Five candidates were explored and verified against current docs**, then pruned: tmux keystroke-injection (dropped — fragile, dominated, billing-gray), Remote Control deep-link (the deep-link is not a real capability), and Channels (undocumented billing, research-preview, admin toggle — no-go). Two survived.

## Decision

Adopt a **staged execution architecture** built behind a **dispatch adapter seam**, so the dispatch mechanism can change without touching the rest of the loop.

**Now — Candidate 2′ (reused interactive session + skill-triggered dispatch).** A pool of ~5 genuinely-interactive `claude` sessions, each started once by the user. Dispatch is a human invoking a custom skill `/work-card <id>` (`.claude/skills/work-card/SKILL.md`, with `arguments`) — typed locally or from the phone via Remote Control, with the card id copied from the board. The skill calls our **MCP server** (the *"local server claude connects to"*) to claim/fetch the task, set up the per-card git worktree, and work it. Every turn is a human-interactive action, so this is **unambiguously subscription-billed** and ships **before June 15**. A later option is to auto-drive the pull with `/loop` (timer-based; see Risks).

**Later — Candidate 3 (pty fresh-per-card).** For full hands-off autonomy and per-card review URLs, spawn a fresh interactive `claude` per claimed card under a pseudo-terminal (`claude "<prompt>"`, no `-p`, on a `node-pty`), and reap it on completion. **Gated** on the A-1 billing bet — that a pty-launched interactive `claude` bills as subscription — which is unverifiable until after the June-15 billing split (see Triggers).

**Built once, dispatch-agnostic (shared substrate, no Claude spawning, zero billing risk):** the atomic Mongo claim (`todo → in_progress`), the WIP=5 cap, a worker/slot registry, per-card worktree prep (`workspaces/card-N/`, branch `aikanban/card-N`), and **MCP `set_my_status` → Mongo completion** plus `card_events` audit. This is the first implementation slice and is reused unchanged under both 2′ and 3.

## Review & verification mechanism

Per-card phone review is **not a hard keystone**. In the reused-session model, when a worker reaches `need_review` it **parks on that card** — the session is left alive and untouched (no `/clear`, no new card), so it can be opened and steered live. The cost is that the slot is occupied until the review resolves (slightly lower effective concurrency), which is acceptable. Verification rests on three already-available layers: the **`card_events` audit log** (caller / from→to / outcome / error), the **git worktree diff** (what actually changed), and the **live parked session**.

## Consequences

**Positive**
- A usable, **billing-safe** product ships now, with no dependency on any unverified billing class.
- The dispatch adapter makes the 2′ → 3 graduation a contained change, not a rewrite.
- Reuses the already-built data model and audit log; the first slice spawns no Claude and carries no billing risk.

**Negative / costs**
- 2′ is **semi-autonomous** — a human triggers each card; it is not hands-off until (and unless) 3 lands.
- A parked review session consumes a pool slot until resolved.
- Reused sessions need **context hygiene** between cards (whether `/clear` truly resets vs. compacts) — an open implementation risk.

**Risks**
- `/loop` auto-drive is timer-driven, requires the process to stay alive, and recurring loops expire after 7 days — so the auto variant of 2′ is bounded; the human-driven variant is the safe default.
- Candidate 3's entire billing-safety is the **A-1 bet**; if pty-launched `claude` is classed programmatic, 3 collapses to "headless with extra steps" and stays shelved.

## Alternatives considered and rejected

- **Candidate 1 — tmux/expect keystroke injection.** Fragile, stateful keystroke driving; strictly dominated by 2′/3 (same MCP→Mongo completion without injection); prior-art argues faking interactivity is billing/ToS-gray.
- **Candidate 4 — Remote Control deep-link/auto-inject.** No documented deep-link-with-prefilled-prompt and no programmatic message API. Its one viable part — a user typing a skill in a Remote Control session — is **absorbed into 2′** as the `/work-card` dispatch.
- **Candidate 5 — Channels webhook.** Billing class undocumented (channels also work with an API key), research-preview/dev-flag, and a Team/Enterprise admin toggle. No-go.
- **Agent SDK / `claude -p` headless.** Moves to the metered pool post-June-15 → violates the hard constraint.

## Triggers / follow-ups

- **June 15, 2026 billing split:** empirically probe, on real Team Premium billing, whether a pty-launched interactive `claude` (Candidate 3) draws from the subscription or the metered pool. **If subscription → build slice 2 (Candidate 3).** If metered → 3 stays shelved; 2′ (human-driven, optionally `/loop`) remains the architecture.
- Decide whether the auto-`/loop` variant of 2′ is worth its 7-day-expiry/timer caveats, or whether human-trigger is sufficient.

## References

- Brainstorm: [billing/constraint](../brainstorm/brainstorm-execution-billing.md), [candidate overview](../brainstorm/brainstorm-execution-overview.md), [synthesis](../brainstorm/brainstorm-execution-synthesis.md), [prior-art](../brainstorm/brainstorm-execution-prior-art.md), and per-candidate detail docs sol-1…sol-5.
- Design: [README](../design/README.md), [scheduler-runner](../design/scheduler-runner.md), [mcp-api-contract](../design/mcp-api-contract.md), [data-model](../design/data-model.md).
