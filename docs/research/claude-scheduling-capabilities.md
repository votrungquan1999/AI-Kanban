# Research — Claude Code scheduling & spawning capabilities

> Decision under study: build a **custom scheduler/runner** ourselves, or **leverage
> Claude Code's own scheduling** (routines / `/loop`) + a skill that calls our MCP?
> Index + recommendation: [README](./README.md). Sibling research:
> [cost-analysis](./cost-analysis.md), [deploy-custom-scheduler](./deploy-custom-scheduler.md),
> [deploy-claude-scheduler](./deploy-claude-scheduler.md).
> Source: claude-code-guide (official docs, current May 2026).

## The product constraint that drives everything

AI-Kanban is **local-first** (design [README](../design/README.md), Path C): the loop
pulls Todo cards → spawns **one Claude Code session per card** operating on the
**user's local git repos** (worktrees under `workspaces/`, branch `aikanban/card-N`)
→ each session is **individually reviewable on the phone** via Remote Control. So the
keystone requirement is: *spawn an independent, locally-executing, individually-
reviewable session per card.*

## Capability matrix

| Primitive | Runs where | Local repo / worktree access | Unattended / persistent | Per-run reviewable URL | Programmatically spawnable |
| --- | --- | --- | --- | --- | --- |
| **Routines** (`/schedule`, cron) | **Anthropic cloud** | ❌ fresh GitHub clone per run only | ✅ persistent cron | ✅ one URL per run | via routines API / triggers |
| **`/loop`** | **local CLI** | ✅ | ❌ needs an open terminal; bare loop expires ~7 days | shares the one session | n/a (one continuous session) |
| **Background agents** (`claude --bg`) | **local** | ✅ full | ⚠️ supervisor keeps them alive, but no built-in cron | ✅ one URL per session | ✅ from shell or `/bg` |
| **Headless** (`claude -p`) / Agent SDK | **local** | ✅ full | ❌ needs a running process | ❌ (exit code / structured output; can capture session id) | ✅ |

## Key findings

1. **Routines are remote and repo-cloning.** Each run executes on Anthropic
   infrastructure, starting from a **fresh clone of specified GitHub repos** off the
   default branch. No local filesystem, no local git worktrees. Each run is a separate
   cloud session with its own claude.ai URL (reviewable on phone). Persistent cron +
   GitHub-event + API triggers. **This is incompatible with the local-first worktree
   model unless the app is redesigned to be GitHub-centric** (see
   [deploy-claude-scheduler](./deploy-claude-scheduler.md)).

2. **MCP in routines:** claude.ai **connectors** work; local **stdio** MCP servers from
   a cloned repo's `.mcp.json` run *in the cloud env*, not locally. Our current MCP is
   **stdio + card-scoped** (`get_my_task`/`set_my_status`, `CARD_ID` env-injected) —
   to drive a routine it would need to be a **cloud-reachable connector** with a
   **queue-level** tool surface (`list_todo` / `claim_next`), which we deliberately did
   NOT build. (Uncertain: interactively-OAuth'd MCP servers in headless runs.)

3. **`/loop` is local but not unattended.** One continuous CLI session, full local
   access, can call MCP — but dies when the terminal closes and a bare loop expires in
   ~7 days. It is also **one session**, so it can't by itself give each card its own
   reviewable session. Useful as a dev-time poller, not a production runner.

4. **Background agents are the local per-card primitive.** `claude --bg` (or `/bg`)
   launches an **independent** local session with **full local FS/worktree access** and
   **its own reviewable URL** on claude.ai / Remote Control — exactly the "one session
   per card, reviewable on phone" unit. They are NOT in-process subagents (the Agent/Task
   tool shares the parent transcript and isn't separately reviewable). But background
   agents have **no built-in scheduler** — something must decide *when* to spawn.

5. **Headless `claude -p` / Agent SDK** are the programmatic local primitives, but also
   carry no scheduling and (for `-p`) no automatic reviewable URL.

## Implication for the build-vs-leverage decision

- The **trigger/cron** concern *could* be offloaded to Claude (routines), but routines
  drag the **execution** into the cloud — which breaks local-first.
- The **execution** concern (per-card, local, reviewable) is best served by
  **background agents** (`claude --bg`) — but those need an external **scheduler**.
- Therefore the natural local-first architecture is a **thin custom Node runner**
  (reconcile + WIP-claim against Mongo — which already emits audit events) that
  **shells out to `claude --bg` per claimed card**, storing the returned session URL on
  the card for phone review. We build the *orchestration*; Claude's background-agent
  supervisor owns *process lifecycle + reviewability*. We do **not** hand-roll session
  management or the review surface.
- Choosing Claude **routines** instead is viable only as a **different product**
  (GitHub-centric, cloud, PR-based) — analyzed in
  [deploy-claude-scheduler](./deploy-claude-scheduler.md), with cost in
  [cost-analysis](./cost-analysis.md).
