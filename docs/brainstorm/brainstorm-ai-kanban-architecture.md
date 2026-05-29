# AI Kanban — Architecture (Zoom Level 2)

> Path C (Hybrid) with a **minimal custom board**, TS/Node, review via claude.ai Remote Control.
> Parents: [problem](./brainstorm-ai-kanban.md) · [solutions](./brainstorm-ai-kanban-solutions.md)

---

## Component Map

```
┌──────────────────────────────────────────────────────────────┐
│  BOARD APP  (Next.js / Node, single deployable)               │
│                                                                │
│  ┌─────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │  Web UI     │   │  REST/tRPC   │   │  MCP Server        │  │
│  │ (4 columns, │──▶│  API         │◀──│ list/create/move   │  │
│  │  add task,  │   │              │   │  task, set_session │  │
│  │  drag card) │   └──────┬───────┘   └─────────┬──────────┘  │
│  └─────────────┘          │                     │             │
│                    ┌──────▼─────────────────────▼──────┐      │
│                    │   DB  (MongoDB)                    │      │
│                    │   cards, recurring_defs, sources   │      │
│                    └──────────────▲─────────────────────┘     │
└───────────────────────────────────│──────────────────────────┘
                                     │ (API/MCP)
        ┌────────────────────────────┴───────────────┐
        │                                             │
┌───────▼──────────┐                        ┌─────────▼──────────┐
│ SCHEDULER /      │   spawns               │ CLAUDE CODE RUNNER │
│ ORCHESTRATION    │───────────────────────▶│ per card:          │
│ LOOP (cron)      │                        │ - git worktree     │
│ - recurring eval │                        │ - claude + Remote  │
│   (poll Notion,  │                        │   Control          │
│    top-2)        │                        │ - inject board MCP │
│ - Todo pickup    │                        │   + CARD_ID        │
│ - WIP limit      │                        │ - capture sess URL │
└──────────────────┘                        └─────────┬──────────┘
                                                       │ runs locally,
                                                       │ steered from
                                                  ┌────▼─────┐
                                                  │ claude.ai │  ← phone review
                                                  │  mobile   │
                                                  └───────────┘
```

Three deployables (could start as one process): **Board App**, **Scheduler**, **Runner** (runner may be a module the scheduler calls).

---

## Multi-Repo Workspace (per-card)

**Problem:** a single task often needs to make changes across **multiple repos at once**, and multiple cards run **concurrently** — so we need per-card isolation _across many repos_, not just one. (`--spawn worktree` is per-repo and can't do this.)

**Decision:** each card gets a **workspace folder containing one git worktree per relevant repo**, stored **inside this project's repo** under `workspaces/` (gitignored).

```
~/Documents/git-repos/personal/        ← parent (container of sibling repos)
  repo-a/  repo-b/  repo-c/            ← real checkouts, stay on main
  ai-kanban/                           ← THIS project's repo
    workspaces/                        ← gitignored
      card-123/
        repo-a/  ← worktree of repo-a on branch aikanban/card-123
        repo-b/  ← worktree of repo-b on branch aikanban/card-123
      card-456/
        repo-a/  ← worktree on branch aikanban/card-456 (no collision)
```

- Launch the session with **`--spawn session`** and **`cwd = workspaces/card-<id>/`** (NOT `--spawn worktree`, which is single-repo). The agent sees all its worktrees; each is isolated on branch `aikanban/card-<id>`, so concurrent cards never collide even on the same repo.
- Worktrees share the repo object store → cheap (only working files duplicated).
- **`.gitignore` `workspaces/`** so the ai-kanban repo never tracks the nested worktree contents (otherwise `git status` shows thousands of foreign files).
- Cleanup on Done: `git worktree remove` each, drop the folder.

### Repo selection is dynamic — decided at pickup, not at intake

Which repos a card touches is determined **when work starts**, by the agent itself:

1. Runner creates an **empty** `workspaces/card-<id>/` and launches the session with read access to the parent (to discover repos).
2. Bootstrap prompt tells the agent: read your card (`get_task`), **scan the sibling repos to find the relevant ones**, and **propose them to the user for confirmation** (via the Remote Control phone chat).
3. On confirmation, the agent calls **`add_repo_to_workspace(card_id, repo)`** (new MCP tool) → runner creates that repo's worktree into the workspace and returns its path.
4. Agent then works across the confirmed worktrees.

This is why the workspace starts empty and there's a dedicated MCP tool: repos are added on demand after user confirmation, never pre-baked at intake.

---

## Data Model (draft)

**card**

- `id`, `title`, `description`
- `status`: `todo | in_progress | need_review | done`
- `priority`: int
- `origin`: `manual | recurring:<def_id>`
- `session_id`, `session_url` (claude.ai Remote Control link), `workspace_path`
- `repos`: list of `{ repo, branch, worktree_path }` — chosen at pickup, confirmed by user (see [Multi-Repo Workspace](#multi-repo-workspace-per-card))
- `created_at`, `updated_at`, `picked_at`, `finished_at`

**recurring_def**

- `id`, `name`, `cron` (or interval)
- `source`: `notion | manual | ...`
- `source_config` (e.g. Notion page/db id, filter)
- `select_rule` (e.g. "top 2 by priority")
- `enabled`

**source** (connection config: Notion token, repo paths, etc.)

---

## MCP / API Surface (the contract)

Borrowed shape from Vibe Kanban; clients = **scheduler** AND **the running agent session**.

| Tool                                         | Caller               | Purpose                                              |
| -------------------------------------------- | -------------------- | ---------------------------------------------------- |
| `list_tasks(status?)`                        | scheduler, agent     | scan board                                           |
| `get_task(id)`                               | agent                | read its own card                                    |
| `create_task(title, desc, priority, origin)` | scheduler, UI        | new Todo card                                        |
| `update_task_status(id, status)`             | scheduler, **agent** | move card (incl. agent self-move out of Need Review) |
| `set_session_url(id, url)`                   | runner               | attach claude.ai link                                |
| `add_repo_to_workspace(id, repo)`            | **agent**            | create a worktree for a user-confirmed repo in the card's workspace |

> Agent self-move is the key behavior: each session is launched with this MCP + its own `CARD_ID`, so when you tell it on your phone "looks good," it calls `update_task_status(CARD_ID, 'done')` itself.

---

## Core Flows

### Flow 1 — Recurring intake (e.g. Notion → top-2)

1. Cron fires a `recurring_def`.
2. Scheduler reads `source` (Notion API), applies `select_rule` (top-2 by priority).
3. `create_task(...)` → cards land in **Todo** (dedupe against existing open cards).

### Flow 2 — Pickup & execute

1. Scheduler polls **Todo** (respecting WIP limit / max concurrent sessions).
2. For each picked card: create an **empty** `workspaces/card-<id>/`, launch **Claude Code + Remote Control** (`--spawn session`, `cwd` = that folder, read access to parent), inject board MCP + `CARD_ID`.
3. Runner captures the **Remote Control URL** → `set_session_url`; `update_task_status(card, in_progress)`.
4. Agent: `get_task(CARD_ID)` → **discover relevant repos** → **ask user to confirm** (phone) → `add_repo_to_workspace(...)` per confirmed repo (worktrees created on demand).
5. Agent works the task across its worktrees.

### Flow 3 — Completion routing

- Agent finishes → decides (per its prompt/policy): confident → `update_task_status(done)`; needs human → `update_task_status(need_review)` and **stays alive**.

### Flow 4 — Phone review (Need Review = my WIP)

1. Card in Need Review shows `session_url`.
2. On phone: open claude.ai session → read transcript/diff → **chat for clarification**.
3. Exit: **(a)** I drag card back to In Progress / to Done, **or** **(b)** the agent, sensing review is done, calls `update_task_status` itself.

---

## ✅ Spike #1: programmatic Remote Control URL — RESOLVED (GREEN, with caveats)

**Finding:** `claude remote-control` is a **pure server mode** that runs **headless** (no TTY/human), once the machine is authenticated. It prints a session URL to stdout, polls Anthropic's API (outbound HTTPS only), and is steerable from claude.ai/mobile while working autonomously — _exactly_ the local-execution + phone-review combo we need. (Pro/Max plan; API keys not supported.)

**Even better — native fit:**

- `--spawn worktree` → each session gets its **own git worktree automatically** — but this is **per-repo**, so it's **superseded for multi-repo tasks** (see [Multi-Repo Workspace](#multi-repo-workspace-per-card)): we build our own per-card multi-repo workspace and launch with `--spawn session` + `cwd`.
- `--spawn session` → single locked session; `--capacity <N>` (default 32) caps concurrency = our **WIP limit, for free**.
- `--allowedTools "..."` → pre-approve tools for autonomous run; remaining prompts approvable **from the phone**. (Resolves much of Spike #3.)
- `--name` / name-prefix for human-readable cards.

**Capture recipe (Runner):** spawn `claude remote-control --name ... --allowedTools ...`, **read stdout**, regex the `https://claude.ai/code/...` URL → `set_session_url(card, url)`. Then it runs autonomously + is phone-steerable.

### Remaining sub-risks (smaller, must still hands-on verify)

1. **stdout URL format is undocumented** → scrape defensively (match `https://claude.ai/code/...`), don't hardcode a path shape. Needs a 10-min hands-on test to confirm exact output.
2. **No local API to list active sessions** → can't query later; **capture the URL at spawn time and persist** it on the card (we already do).
3. **Task injection:** server mode has **no documented stdin task-injection API**. → **Design answer:** don't inject the prompt. Put the task **on the board**; launch each session with a **generic bootstrap prompt** + `CARD_ID` env var → the agent calls `get_task(CARD_ID)` via MCP to read its own assignment, does it, then `update_task_status`. The board _is_ the task queue. (Confirm how server mode takes an initial bootstrap prompt during the hands-on test.)
4. **Plan gate:** requires Pro/Max + `claude auth login` (no API key path).

**Fallback ladder if the hands-on test surprises us:** PTY wrapper to scrape `/remote-control` output → two-phase local daemon → degrade to headless `claude -p` + archived transcript (lose live steering).

**Net:** the project's central bet is validated. The remaining work is a short hands-on confirmation of stdout format + bootstrap-prompt mechanics, not a fundamental unknown.

## Other Risks / Spikes

- **Spike #2: keep-alive at scale.** Each in-progress/need-review card = a live local process; machine must stay online (~10-min net timeout). Need a process supervisor + crash recovery (reconcile DB ↔ live sessions on restart).
- **Spike #3: permissions.** **Decided** — see [Side-effect & Permission Policy](#side-effect--permission-policy-decided). Run broad/auto for autonomy; gate via prompt-defined prohibitions, not hard gates.
- **Notion auth & dedupe** (you have a Notion MCP available — could reuse).
- **WIP limits** to cap concurrent Claude Code sessions (cost + machine load).

---

## Side-effect & Permission Policy (decided)

**Decision:** gating is done by **clearly specifying "what not to do" in every session's bootstrap prompt** — a fixed prohibition list defined up front. Run permissions broad/auto for **autonomy**; **no hard gates** (they'd defeat the autonomous goal). The prompt rules _are_ the gate.

**Baseline prohibitions** (reused verbatim in every bootstrap prompt; refine over time):

- No writes/mutations to **production databases** (the prior incident) — use only a sandbox/test DB if one is provided.
- No `git push` / force-push / branch deletion outside the card's own `aikanban/card-<id>` branch.
- No side-effecting external calls (emails, third-party APIs, cloud-resource deletion) unless the task explicitly requires it.
- Stay within the card's worktrees; don't touch `main` or other repos' working state.

**Why this is acceptable here:** solo, personal tool where autonomy is the priority. Git/filesystem side effects are already reversible via the per-card worktree branch (reviewed at merge).

**Accepted residual risk (eyes open):** prompt prohibitions are a **soft, probabilistic** gate — they rely on the agent following them, and **external** side effects (DB/network) are **not** covered by the worktree-branch safety net. If clear-rules-only proves insufficient in practice, the fallback is reversibility-first guardrails (runner injects sandbox/read-only credentials so prod mutation is impossible) — deliberately **not** adopted now.

---

## Zoom Level 3 (next): pick the build order

Proposed slice order (thin vertical slices, TDD per [feature guide](./.claude/rules/feature-development-guide.md)):

1. Board app: data model + 4-column UI + manual `create_task` + drag-to-move.
2. MCP server exposing the 5 tools (manual move works end-to-end).
3. Runner spike: **prove Remote Control URL capture** (Spike #1) on one hardcoded card.
4. Scheduler: Todo pickup → runner → in_progress, with WIP=1.
5. Completion routing + agent self-move from Need Review.
6. Recurring intake (Notion top-2).
7. Keep-alive supervisor + crash recovery.
