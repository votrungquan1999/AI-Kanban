# Research — Scheduler: build our own vs. leverage Claude

**Question.** For the autonomous loop, should we **build a custom scheduler/runner**,
or **leverage Claude Code's own scheduling** (routines / `/loop`) + a skill that calls
our MCP server?

**Answer (recommended): build a *thin* custom runner that spawns `claude --bg` per
card.** Don't build session management or a review surface (Claude's background-agent
supervisor owns those); don't adopt routines (they're remote and break local-first).

This folder holds the supporting research. Parent: [design README](../design/README.md)
· keystone design: [scheduler-runner.md](../design/scheduler-runner.md).

| Doc | Covers |
| --- | --- |
| [claude-scheduling-capabilities.md](./claude-scheduling-capabilities.md) | What routines / `/loop` / background agents / headless can and can't do |
| [cost-analysis.md](./cost-analysis.md) | Subscription tiers, API token rates, per-card estimate, routine caps |
| [deploy-custom-scheduler.md](./deploy-custom-scheduler.md) | Deployment topology if we build the runner |
| [deploy-claude-scheduler.md](./deploy-claude-scheduler.md) | What adopting routines would require (a different product) |

---

## Why "build", in one screen

The product keystone (Path C) is: **one local Claude session per card, on the user's
local git repos, individually reviewable on the phone.** Mapping that onto Claude's
primitives:

- **Routines** own cron + persistence + per-run review — but run **remotely** off a
  **fresh GitHub clone**. No local repos, no worktrees. Using them isn't deploying
  AI-Kanban; it's building a **GitHub/PR/cloud** successor product
  ([deploy-claude-scheduler](./deploy-claude-scheduler.md)). They're also capped at
  **~15 runs/day** (Max), below the target volume ([cost-analysis](./cost-analysis.md)).
- **`/loop`** is local but a single attended session that dies with the terminal — a
  dev poller, not a runner.
- **Background agents (`claude --bg`)** are the right execution unit: **local**, full
  repo/worktree access, **one reviewable claude.ai URL per session**. They lack a
  scheduler — so *something* must decide when to spawn.

So the only piece genuinely missing is the **"when to spawn" orchestration** — a thin
reconcile + WIP-claim loop over Mongo (which already emits
[card_events](../design/data-model.md#card_events-implemented)) that shells out to
`claude --bg` per claimed card and stores the returned session URL on the card. We
build that; Claude owns process lifecycle + review.

## Cost picture (solo scale)

- **API metered:** ~**$0.20–0.65/card** (Sonnet, with caching); ~$0.40–1.50 (Opus).
- **Flat subscription:** **Max 5x ($100/mo)** likely covers a few-dozen Sonnet
  cards/day — *if* `claude --bg` draws from the subscription (see open question below).
- **Opus weekly cap** binds first for Opus-heavy use (~>10 cards/day) → prefer Sonnet,
  reserve Opus for hard cards.
- **Routines** cost less to operate but the **15 runs/day cap** + cloud model rule them
  out here regardless.

## Recommended deployment (custom route)

From [deploy-custom-scheduler.md](./deploy-custom-scheduler.md):

```
 ┌─ user's Mac (must be awake to RUN cards) ─────────────┐        ┌─ cloud ─┐
 │  launchd LaunchAgent  (caffeinate -is, auth in env)   │        │         │
 │     └─ runner: reconcile + WIP-claim ──► claude --bg ─┼──URL──►│ Atlas   │◄── board (Vercel)
 │           (per card; stores session URL)              │        │  M0     │      ▲ phone
 └───────────────────────────────────────────────────────┘        └─────────┘──────┘
```

- **Runner:** launchd LaunchAgent (`RunAtLoad`+`KeepAlive`), wrapped in `caffeinate`.
- **DB:** Atlas **M0** (free) — reachable by both the local runner and the cloud board.
- **Board:** Vercel → Atlas, so the phone reaches it even while the Mac sleeps (only
  *new execution* needs the Mac awake).
- **Review:** phone opens the board → taps each card's stored claude.ai session URL.
- Simpler starter: all-local (local `mongod` + `next start` over Tailscale), migrate later.

## Open questions to resolve before building

1. **Billing of `claude --bg` / headless — the load-bearing unknown.** Does an
   unattended background/headless session draw from the **Max subscription** or require
   **API billing**? The flat-rate economics hinge on this. **Note the June 15 2026
   billing split** (headless/SDK usage moves off the subscription) — verify empirically
   and soon. ([cost-analysis](./cost-analysis.md))
2. **Unattended Claude auth** in a launchd daemon — `CLAUDE_CODE_OAUTH_TOKEN`
   (subscription) vs `ANTHROPIC_API_KEY` (24/7 fleet). The interactive browser OAuth
   won't persist for a daemon.
3. **`--bg` concurrency / rate limits** under a WIP limit > a few cards at once.
4. **"Machine awake" tolerance** — fine for a laptop-on-desk solo flow; a dedicated
   always-on Mac mini if overnight throughput matters.

## Suggested first slice (unchanged by this research)

The **reconcile-and-claim loop**: atomic `todo → in_progress` pickup against a WIP
limit, emitting audit events — **no process spawning yet**. Small, testable, exercises
the audit log. Spawning `claude --bg` + storing the session URL is the *next* slice,
after we've empirically answered open question #1.
