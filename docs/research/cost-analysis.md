# Research — Cost of powering AI-Kanban with Claude

> Decision under study: what does it **cost** to run AI-Kanban's "one Claude Code
> session per card" model, and which architecture is cheaper at solo scale —
> a local runner spawning `claude --bg`, or Anthropic-cloud **routines**?
> Index + recommendation: [README](./README.md). Capability analysis (what each
> primitive can do): [claude-scheduling-capabilities](./claude-scheduling-capabilities.md).
> Prices verified **May 30, 2026** against official Anthropic docs (see [Sources](#sources)).

## TL;DR

- At solo scale (a handful to a few dozen coding cards/day), **a Max 5x subscription
  ($100/mo) driving local `claude --bg` background agents is the cheapest path** — flat
  fee, full local repo access, one reviewable session per card.
- **The big gotcha:** starting **June 15, 2026**, programmatic Claude Code
  (`claude -p` and the Agent SDK) **no longer counts toward your subscription** — it
  draws from a separate monthly **Agent SDK credit** (= your plan fee), then bills at
  full **API rates**. Whether `claude --bg` is "interactive" (free under the sub) or
  "programmatic" (Agent-SDK pool) is **NOT documented** — this is the single biggest
  open risk for this project. See [The June 15 billing split](#the-june-15-2026-billing-split).
- A typical with-caching coding session costs roughly **$0.20–$1.50 in API tokens**
  (Sonnet) or **$0.50–$3** (Opus). So even pure pay-as-you-go at 20 cards/day lands
  around **$120–$600/mo** depending on model — i.e. once you exceed ~1–2 dozen Opus
  cards/day, the flat Max plan wins decisively, *if* `--bg` stays subscription-funded.
- **Routines are cloud + GitHub-clone** (incompatible with the local-first worktree
  model per [capabilities](./claude-scheduling-capabilities.md)) AND are **hard-capped
  at 15 runs/day on Max**. They are not a fit as the primary runner regardless of cost.

---

## 1. Subscription tiers, limits, and the per-day constraint

| Plan | Price/mo | Rough 5-hour window | Weekly Sonnet | Weekly Opus | Routine runs/day |
| --- | --- | --- | --- | --- | --- |
| **Pro** | **$20** | small | limited | very limited | **5** |
| **Max 5x** | **$100** | ~88k tokens | ~140–280 hrs | ~15–35 hrs | **15** |
| **Max 20x** | **$200** | ~220k tokens | ~240–480 hrs | ~24–40 hrs | 15 (Max) |

(Window/weekly figures are community-reported estimates; Anthropic does not publish exact
token numbers — **flagged as approximate**. Prices confirmed on the official Max page.)

**How limits constrain "many sessions/day":**
- Limits are a **rolling 5-hour window** plus a **weekly active-compute cap** (added
  Aug 2025 specifically to stop 24/7 background usage). They count only while Claude is
  *actively processing*, not idle.
- The bucket is **shared across Claude.ai chat and Claude Code** — browser chatting eats
  the same allowance your card-runner needs.
- **Opus is the binding constraint.** Max 5x gives only ~15–35 Opus hours/week. If each
  card is a ~20-min Opus session, that's ~45–105 Opus cards/week (~6–15/day) before you
  hit the weekly wall. Sonnet is far roomier (hundreds of hours/week) → dozens of
  Sonnet cards/day fit comfortably on Max 5x.
- **Practical read:** Max 5x covers solo Sonnet-heavy volume easily; Opus-heavy volume
  at >~10 cards/day will hit the weekly Opus cap and should either downshift to Sonnet
  or move to metered API.

---

## 2. API pay-as-you-go token pricing (current models)

Per **million tokens (MTok)**, from the official Anthropic pricing page:

| Model | Input | 5-min cache write | 1-hr cache write | Cache read (hit) | Output |
| --- | --- | --- | --- | --- | --- |
| **Opus 4.7 / 4.6 / 4.5** | $5 | $6.25 | $10 | **$0.50** | $25 |
| **Sonnet 4.6 / 4.5** | $3 | $3.75 | $6 | **$0.30** | $15 |
| **Haiku 4.5** | $1 | $1.25 | $2 | **$0.10** | $5 |
| Opus 4.1 (legacy) | $15 | — | — | $1.50 | $75 |

**Prompt caching** (the key cost lever for long coding sessions):
- Cache **read = 0.1x** base input ($0.50/MTok Opus, $0.30 Sonnet). Cache **write =
  1.25x** (5-min) or **2x** (1-hr).
- Caching pays off after **one** cache read (5-min) or **two** reads (1-hr).
- In a real reported 170-turn session, caching cut an Opus run from **$168 → $21** —
  >98% of input tokens were cache reads. Coding sessions are extremely cache-friendly
  because the system prompt, repo files, and tool defs are re-sent every turn.

**Batch API** = 50% off input+output and stacks with caching — but **not usable here**:
batch is async and stateless, while card sessions are interactive/stateful. Noted for
completeness only.

**Tokenizer caveat:** Opus 4.7+ uses a new tokenizer that can emit **up to 35% more
tokens** for the same text vs 4.6 at unchanged per-token prices — effective cost per
request can rise up to 35% on the newest Opus. **Flagged.**

---

## 3. Cost of ROUTINES (cloud) specifically

From the Claude Code routines docs and launch coverage (research preview, launched
**Apr 14, 2026**):

- **Billing:** routine runs **draw down your subscription usage the same way
  interactive sessions do** — they are *not* free managed compute and (pre-overage) do
  not require separate API credits. No documented surcharge for the managed cloud
  execution itself beyond the usage it consumes.
- **Daily run cap (hard limit):** **Pro 5/day, Max 15/day, Team/Enterprise 25/day.**
  This is a per-account ceiling *on top of* normal usage limits.
- **Min interval:** schedules faster than **once per hour** are rejected.
- **Overage:** if you hit the daily cap or your usage limit, accounts with "extra usage"
  enabled continue on **metered overage at API rates**; otherwise runs are rejected
  until the window resets.
- **Concurrency:** specific concurrent-run limits are **not published** — **flagged as
  unconfirmed**. The 1-hour min interval + 15/day cap make concurrency largely moot for
  solo use anyway.

**Implication:** even ignoring the cloud/GitHub-clone incompatibility (see
[capabilities](./claude-scheduling-capabilities.md)), the **15 runs/day** ceiling alone
caps routines below the "few dozen cards/day" target. Routines are unsuitable as the
primary per-card runner.

---

## 4. Cost model of BACKGROUND AGENTS / headless local runs

These execute on the **user's machine**, so the marginal cost = the underlying model
usage. The question is *which billing pool* that usage hits:

- **`claude -p` (headless) today:** in practice it **bypasses OAuth and uses
  `ANTHROPIC_API_KEY`**, so it **bills to the API account at pay-as-you-go rates** — it
  does **not** draw from a Max subscription. (A documented incident shows a Max user
  unintentionally racking up **$1,800+ in two days** via suggested `claude -p` usage.)
  **Treat headless `-p` as API-metered.**
- **Interactive Claude Code (terminal/IDE):** draws from the **subscription** limits.
- **Background agents (`claude --bg` / `/bg`):** **NOT explicitly classified** in the
  billing docs as interactive vs programmatic. This is the **critical unknown** for
  AI-Kanban, because `--bg` is our chosen per-card primitive. **Flagged — must be
  verified empirically before committing the architecture.**

### The June 15, 2026 billing split

Effective **June 15, 2026** (i.e. ~2 weeks from this doc's date — imminent):

- **Programmatic** usage — **Agent SDK** (Python/TS), **`claude -p`**, **Claude Code
  GitHub Actions**, and third-party apps authing via the SDK — **stops counting against
  subscription limits**. Interactive terminal/IDE use stays on the subscription.
- Each plan gets a **separate monthly Agent SDK credit** equal to its fee: **Pro $20,
  Max 5x $100, Max 20x $200**, billed at **full API rates**.
- When that credit is exhausted, usage **overflows to API rates** *only if* usage
  credits are enabled; otherwise programmatic requests **stop** until the monthly
  refresh.
- **Why this matters for AI-Kanban:** if the runner uses `claude -p` / Agent SDK (the
  natural programmatic spawn), card sessions consume the **$100 Agent SDK credit at API
  prices** — effectively ~$100/mo of metered tokens, then real API billing beyond. The
  flat-rate advantage of Max only survives if `claude --bg` is classified as
  **interactive** (subscription-funded). **Resolve this before building.**

---

## 5. Per-card cost estimate

**Assumptions for one "typical" card** (minutes-to-~1hr coding session, caching on):
- ~**60k effective input tokens** (mostly cache reads after warmup) + ~**12k output**.
- With caching, treat input as ~50k cache-read + ~10k fresh write-equivalent.

**Sonnet 4.6 per card (with caching):**
- Cache reads 50k x $0.30/M = $0.015; fresh input 10k x $3/M = $0.03; output 12k x
  $15/M = $0.18 → **~$0.22/card** (light). A heavier 3x-token card ≈ **~$0.65**.

**Opus 4.7 per card (with caching):**
- Cache reads 50k x $0.50/M = $0.025; fresh input 10k x $5/M = $0.05; output 12k x
  $25/M = $0.30 → **~$0.38/card** (light). Heavier ≈ **~$1.50** (and +up to 35% for the
  new tokenizer). Without caching the same Opus card is **$1–$3+**.

**Use a planning band: Sonnet ~$0.20–$0.65/card, Opus ~$0.40–$1.50/card.** These are
estimates, not measured — **flagged**; AI-Kanban should record real `usage` per session.

### Daily/monthly API cost and fraction of a Max plan

Monthly = per-day x ~22 active days. "Frac of Max 5x" uses the $100 Agent-SDK-credit /
subscription value as the reference pool.

| Cards/day | Sonnet $/day | Sonnet $/mo | Opus $/day | Opus $/mo | vs Max 5x ($100) |
| --- | --- | --- | --- | --- | --- |
| **5** | ~$1.10–$3.25 | ~$24–$72 | ~$2–$7.50 | ~$44–$165 | Sonnet well under; Opus ~half-to-over |
| **20** | ~$4.40–$13 | ~$97–$286 | ~$8–$30 | ~$176–$660 | Opus blows past; Sonnet near/over |
| **50** | ~$11–$32 | ~$242–$715 | ~$20–$75 | ~$440–$1650 | Far past flat plan either model |

**Reading it:** at **5 cards/day** almost everything fits inside a Max 5x flat fee. At
**20/day** Sonnet is borderline and Opus clearly exceeds the flat fee on pure API. At
**50/day** flat-rate is the only sane option (assuming `--bg` is subscription-funded and
you stay under weekly caps).

---

## 6. Architecture cost comparison (monthly, solo scale)

### (a) Custom local runner spawning `claude --bg`

| Funding model | Monthly cost | Where it gets expensive / rate-limited |
| --- | --- | --- |
| **`--bg` = subscription** (best case, **unconfirmed**) | **$100 flat (Max 5x)** | Weekly **Opus cap** (~15–35 hrs) bites at >~10 Opus cards/day; 5-hr window can throttle bursts. Sonnet roomy. |
| **`--bg` = Agent-SDK pool** (post-Jun-15, if classed programmatic) | **$100 credit then API rates** | Effectively API-metered: Opus at 20+/day overflows to real $ (see §5 table). |
| **Pure API key** (headless `-p` today) | **Pay-as-you-go** (see §5) | Scales linearly; cheap at 5/day, expensive Opus at 20+/day. No flat cap protection. |

Strengths: full **local repo/worktree** access, one **reviewable URL per card** (matches
the product), no per-card cloud ceiling. We supply the scheduler/reconciler.

### (b) Claude routines (cloud)

| Aspect | Cost / limit |
| --- | --- |
| Billing | Draws from **subscription usage** (then metered overage at API rates). |
| Hard cap | **15 runs/day (Max)** — below the "few dozen cards/day" target. |
| Min cadence | **1 run/hour**. |
| Fit | **Cloud + fresh GitHub clone**, no local worktrees → breaks local-first model. |

Strengths: zero infra to run (managed cron + reviewable session per run). Fatal for this
product: the **15/day cap** and the **cloud/GitHub-clone execution model**.

### Verdict

For **solo, local-first** AI-Kanban: **(a) local runner + `claude --bg` on Max 5x
($100/mo flat)** is cheapest and the only architecture that satisfies local-worktree +
per-card-review. Routines lose on both the **15/day cap** and local incompatibility.
**Conditioned on** confirming `--bg`'s billing class post-June-15; if `--bg` turns out
programmatic/API-metered, redo the math with §5 and consider capping cards or defaulting
to **Sonnet** to control spend.

---

## Open questions / things I could not confirm

1. **Is `claude --bg` interactive (subscription) or programmatic (Agent-SDK pool) after
   June 15, 2026?** Not documented. **Highest-impact unknown.**
2. Exact subscription token/hour limits per window — Anthropic publishes only ranges;
   table figures are community estimates.
3. Routine **concurrency** limit — not published.
4. Per-card token figures are **modeled, not measured** — instrument real usage.

---

## Sources

- Use Claude Code with Pro/Max — https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- Max plan pricing — https://claude.com/pricing/max
- Claude API pricing (official; model rates, caching multipliers, batch) — https://platform.claude.com/docs/en/about-claude/pricing
- Prompt caching docs — https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Use the Claude Agent SDK with your Claude plan (June 15 credit) — https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Automate work with routines (Claude Code docs) — https://code.claude.com/docs/en/web-scheduled-tasks
- Claude Code Routines launch coverage — https://www.claudeapi.com/en/blog/dev-guides/claude-code-routines-cloud-automation-2026/
- The Register on routines — https://www.theregister.com/software/2026/04/14/claude-code-routines-promise-mildly-clever-cron-jobs/
- June 15 billing change guide — https://www.buildthisnow.com/blog/guide/mechanics/claude-billing-change-june-2026
- `claude -p` unintended API billing incident — https://github.com/anthropics/claude-code/issues/37686
- Rate limits / usage quotas explainer — https://www.truefoundry.com/blog/claude-code-limits-explained
- Session cost / caching deep dive — https://recca0120.github.io/en/2026/04/13/claude-code-session-cost-cache-misconception/
- Manage costs (Claude Code docs) — https://code.claude.com/docs/en/costs
