# Deploy via Claude's scheduling (routines) — what AI-Kanban would have to BECOME

> Decision under study: **lean on Claude's cloud scheduling (routines)** instead of
> building our own runner. This is the cloud/GitHub-centric counterpart to the
> local-first analysis.
> Index + recommendation: [README](./README.md). Siblings:
> [claude-scheduling-capabilities](./claude-scheduling-capabilities.md),
> [cost-analysis](./cost-analysis.md).
> Design context: [data-model](../design/data-model.md),
> [mcp-api-contract](../design/mcp-api-contract.md).
> Source: official routines docs + GitHub Actions + MongoDB Atlas + Vercel (May 2026).

## TL;DR verdict

Routines can absolutely *schedule* and *review* per-card AI sessions — that part is a
clean fit. But routines run **remotely on Anthropic cloud from a fresh GitHub clone**,
with **no local filesystem**. Adopting them is not a deployment choice; it is a
**different product**: GitHub-centric, PR-based, cloud-DB. It deletes the keystone of
Path C (local repos + worktrees + instant local iteration). For *this* local-first
product the routines route is **not worth it** — but it is the right spine for a
*successor* product if local execution is ever dropped. See [§7](#7-lost-vs-gained)
and [§8](#8-hybrid).

---

## 1. The fundamental conflict

AI-Kanban today (Path C, [data-model](../design/data-model.md)) is built on **local
filesystem facts**:

- Each card gets `workspacePath: "workspaces/card-123"` and a git **worktree per repo**
  (`repos[].worktreePath`, branch `aikanban/card-123`).
- A session is spawned **locally** against those worktrees; the user iterates on real
  files on a real machine; the board reviews on the phone via Remote Control.

Routines violate every one of these. Per the
[routines docs](https://code.claude.com/docs/en/routines): *"Routines execute on
Anthropic-managed cloud infrastructure"* and *"Each repository you add is cloned on
every run … starting from the default branch."* There is **no local FS, no worktree,
no persistent checkout** between runs.

**What breaks, concretely:**

| Today (local-first) | Under routines |
| --- | --- |
| `workspaces/card-N` worktree tree | gone — a fresh `git clone` per run, discarded after |
| `repos[].worktreePath` on the card | meaningless — no stable local path |
| iterate on uncommitted local files | impossible — state must live on a `claude/` branch or in commits |
| operate on the user's *local* repo | only repos **hosted on GitHub** are reachable |
| runner shells out `claude --bg` locally | nothing local runs; orchestration is cloud |

The worktree model and instant local iteration are **incompatible** with routines.
This is not patchable — it forces a redesign.

---

## 2. What the app must BECOME — GitHub-centric target architecture

To use routines, AI-Kanban becomes a **GitHub-centric, PR-based orchestrator**:

1. **Repos live on GitHub.** No `workspaces/`, no worktrees. The "workspace" is now a
   `claude/`-prefixed branch in the remote repo. (Default push restriction is to
   `claude/*`; *"Allow unrestricted branch pushes"* exists but defeats the safety
   point.)
2. **Each card → one routine run.** The run clones the repo(s) off the default branch,
   creates `claude/card-123`, does the work, and **opens a PR** — *"review changes,
   create a pull request"* is the native end-state of a run.
3. **The card holds a PR + a session URL**, not a worktree path. `repos[].worktreePath`
   is replaced by `prUrl` / `branch: claude/card-123`.
4. **Review = the PR + the run's claude.ai session URL** ([§6](#6-reviewability)).
5. **Iteration = follow-up commits on the branch / PR**, or re-firing the routine — not
   editing local files.

```
 Board (Vercel) ──fire──▶ Routine (Anthropic cloud)
       ▲                        │ git clone (default branch)
       │ claim/update           │ work on claude/card-123
       │ (connector MCP)        ▼
   MongoDB Atlas            open PR on GitHub ──▶ phone review (PR + session URL)
```

This is structurally close to the **Claude Code GitHub Action** model
([docs](https://code.claude.com/docs/en/github-actions)): clone → branch → PR, the unit
of review is a PR. The difference is routines add the **scheduler + per-account
cloud sessions**, which the Action alone does not.

---

## 3. How cards map to routine runs

Three candidate mappings (all from the
[routines triggers](https://code.claude.com/docs/en/routines)):

**(A) One cron routine that claims the next card.** A single scheduled routine
(min interval **1 hour**) wakes, calls a `claim_next` tool, works that one card, opens a
PR. Simple, one routine to manage — but **serial** (one card per wake, ≥1h cadence) and
the prompt is generic ("claim and do whatever's next"), which is weak for autonomous
runs that *"must be self-contained and explicit."*

**(B) Routines **API** trigger — one fire per card (RECOMMENDED).** The board owns the
*decision* of when a card is ready and POSTs to the routine's `/fire` endpoint:

```bash
curl -X POST https://api.anthropic.com/v1/claude_code/routines/$RID/fire \
  -H "Authorization: Bearer $TOKEN" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -d '{"text": "Work card #123: <title + description + repo>"}'
```

It returns `{ claude_code_session_id, claude_code_session_url }` immediately — exactly
the per-card reviewable session URL the card already stores in `session.url`. Each fire
= one independent session = one card. This preserves AI-Kanban's "one reviewable
session per card" semantics *and* lets the **board** keep owning prioritization/WIP
limits. Caveat: **no idempotency key** — a retried POST creates duplicate sessions, so
the board must guard fires with a claim/state transition.

**(C) GitHub-event triggers.** `pull_request.opened` / `closed` etc. Great for
*reactive* automation (review-on-PR, port-on-merge) but the trigger is a *GitHub event*,
not a *board card* — it doesn't model "a todo card becomes a run." Useful as a
*secondary* trigger (e.g. auto-review the PR a card produced), not the primary mapping.

**Recommendation: (B), the API trigger.** "A todo card becomes a routine run" = the
board transitions the card `todo → in_progress`, fires the routine with the card's
context as `text`, and stores the returned `session_url` on the card. The board stays
the brain; routines are the (cloud) muscle. Note `/fire` runs draw the per-account
**daily routine run cap** + subscription usage (see [cost-analysis](./cost-analysis.md)).

---

## 4. Where the DB + board live

If orchestration is cloud, keeping Mongo on the user's laptop makes no sense — the
routine could not reach it (cloud env blocks arbitrary hosts: outbound to
non-allowlisted hosts fail `403 host_not_allowed`). So:

- **Board → Vercel.** The Next.js 16 app + its API routes deploy to Vercel. It does the
  firing, the claiming, the PR-status reconciliation.
- **DB → MongoDB Atlas.** Use the **native driver** from Vercel functions with a cached
  client on `global` and a small `maxPoolSize` (5–10) to survive serverless cold/warm
  cycling and avoid Atlas connection exhaustion
  ([Vercel guide](https://vercel.com/guides/connection-pooling-with-serverless-functions),
  [Atlas+Vercel](https://www.mongodb.com/developer/languages/javascript/integrate-mongodb-vercel-functions-serverless-experience/)).
  Allowlist `0.0.0.0/0` (or Vercel Secure Compute static egress) in Atlas Network
  Access.

**How does a routine read/claim cards?** Two options:

- **Via the board's HTTP API (RECOMMENDED).** The routine calls
  `POST /api/cards/{id}/status` etc. on the Vercel board. The board is the single writer
  to Mongo; the routine never touches the DB directly. Clean, but the board's host must
  be in the routine environment's **Allowed domains** allowlist.
- **Via a connector MCP over the DB** ([§5](#5-the-mcp-servers-fate)). The routine talks
  to a hosted MCP that wraps the core service. Connector traffic is *"routed through
  Anthropic's servers,"* so it works **without** allowlisting the board host — a real
  advantage. This is the cleaner fit for the existing MCP-shaped contract.

> Note: the old **Atlas Data API / custom HTTPS endpoints are deprecated** (EOL Sep 30,
> 2025 — [MongoDB docs](https://www.mongodb.com/docs/atlas/app-services/data-api/data-api-deprecation/)),
> so "let the routine hit the Data API directly" is **not** an option. It must be a
> connector MCP or our own Vercel API.

---

## 5. The MCP server's fate

Today the MCP is **stdio + card-scoped** (`get_my_task` / `set_my_status`, `CARD_ID`
env-injected — [mcp-api-contract](../design/mcp-api-contract.md)). Stdio over a cloned
repo would run **in the cloud sandbox**, not against our service.

To drive routines it must become a **hosted connector** (HTTP/SSE) registered at
`claude.ai/customize/connectors`, since *"all of your connected MCP connectors are
included by default"* in a routine and their traffic is proxied by Anthropic. Adding it
as a connector (or declaring it in a committed `.mcp.json`) is the only way the routine
reaches our queue.

The tool surface must also change shape. A routine fired generically needs **queue-level
tools we deliberately did NOT build**:

- `list_todo()` → cards in `todo`, prioritized.
- `claim_next()` → atomically move the top card `todo → in_progress`, return its context
  (single-document `findOneAndUpdate`, already our concurrency pattern).
- `set_status(cardId, status)` / `attach_pr(cardId, prUrl)`.

The old per-`CARD_ID` scoping (one agent ↔ one card) weakens here: a cloud connector is
account-scoped, not card-scoped. Scoping must move to **claim semantics** (a run owns
the card it claimed) rather than an env-injected `CARD_ID`. With mapping (B) we can pass
the `cardId` in the fire `text` and keep scoping per-call, which is closer to today.

---

## 6. Reviewability — the clean fit

This is where routines genuinely shine. *"Each run creates a new session … see what
Claude did, review changes, create a pull request,"* and `/fire` returns a
`claude_code_session_url` (`https://claude.ai/code/session_…`). That maps **directly**
onto AI-Kanban's existing `card.session.url` and the phone-review flow — no Remote
Control glue needed; claude.ai already renders the run on mobile. One card → one PR →
one reviewable cloud session. The review story is arguably *better* than today's local
Remote Control hack.

Caveat from the docs: a **green run status ≠ task success** — it only means the session
started/exited without infra error. The board must read the PR/transcript to know the
card actually succeeded, so card `runState` reconciliation still needs real logic.

---

## 7. Lost vs gained

**LOST:**

- **Local repo access** — only GitHub-hosted repos work. Private local-only repos are
  out.
- **The worktree model** (`workspaces/`, `repos[].worktreePath`) — replaced by remote
  `claude/*` branches.
- **Instant local iteration** — no editing uncommitted files; iteration is commits/PRs
  or re-fires; cron floor is 1 hour.
- **The original Path C vision** — "AI works on *my* machine on *my* repos, reviewed on
  my phone" becomes "AI works in the cloud on my GitHub, reviewed as PRs."
- **Card-scoped stdio MCP** — must be rebuilt as an account-scoped hosted connector.

**GAINED:**

- **Zero local infra** — no always-on machine, no local runner, no `claude --bg`
  supervisor, no laptop-must-be-awake constraint.
- **Anthropic-managed persistence + scheduling** — cron, GitHub, and API triggers are
  maintained for us; runs survive a closed laptop.
- **Native reviewable cloud sessions + PRs** ([§6](#6-reviewability)).
- **Managed scale** — many cards fire independent cloud sessions without us managing
  process lifecycle.

---

## 8. Hybrid: Claude owns cron, calls back to a local component

Tempting idea: keep cron in the routine, but have the routine **call back** to a small
local agent that does the real work on local repos. **Not feasible**, plainly:

- Routine runs are **sandboxed cloud sessions** with a **restricted egress allowlist**;
  reaching a *home* machine means it sits on a public, allowlisted URL — i.e. you've
  already built an always-on, internet-exposed local server (a tunnel/ngrok-style
  endpoint), which **re-introduces the exact local infra routines were meant to remove**
  and adds a serious attack surface.
- Even then the routine itself still can't touch local files — it would just be a
  glorified HTTP cron hitting your box, at which point a plain OS cron / our own thin
  runner ([claude-scheduling-capabilities §"Implication"](./claude-scheduling-capabilities.md))
  is simpler and keeps execution local.
- The connector path *is* a callback (routine → hosted MCP), but that MCP must reach
  **cloud** data (Atlas), not the local FS — so it doesn't rescue local execution.

Conclusion: there is **no clean hybrid** that keeps both Anthropic-owned cron **and**
local repo execution. You pick one world.

---

## Sources

- Automate work with routines — Claude Code Docs: https://code.claude.com/docs/en/routines
- Trigger a routine via API — Claude Platform Docs: https://platform.claude.com/docs/en/api/claude-code/routines-fire
- Introducing routines in Claude Code — Anthropic blog: https://claude.com/blog/introducing-routines-in-claude-code
- Claude Code GitHub Actions — Claude Code Docs: https://code.claude.com/docs/en/github-actions
- anthropics/claude-code-action — GitHub: https://github.com/anthropics/claude-code-action
- Atlas Data API & HTTPS Endpoints deprecation — MongoDB Docs: https://www.mongodb.com/docs/atlas/app-services/data-api/data-api-deprecation/
- Connection pooling with Vercel Functions — Vercel: https://vercel.com/guides/connection-pooling-with-serverless-functions
- Integrate MongoDB Atlas with Vercel Functions — MongoDB Developer: https://www.mongodb.com/developer/languages/javascript/integrate-mongodb-vercel-functions-serverless-experience/
- MongoDB Atlas for Vercel integration — Vercel: https://vercel.com/integrations/mongodbatlas
