# AI Kanban — Solution Exploration

> Companion to [brainstorm-ai-kanban.md](./brainstorm-ai-kanban.md). This file develops the zoom levels.

---

## Zoom Level 0: Reframe — What is this system, really?

Before "kanban board," step back. The **board is just the human interface**. The actual product is an **autonomous task-orchestration loop** with a phone-first review surface. Three sub-systems:

1. **Task Intake** — a UI to add one-time tasks + recurring task definitions (e.g. "poll Notion, pick top-2 priority"). Produces cards in **Todo**.
2. **Orchestration Loop** — a scheduler that periodically: pulls from Todo → launches a **local Claude Code session with Remote Control** → moves card to **In Progress** → on completion routes to **Need Review** (with claude.ai session link) or **Done**.
3. **Review Surface** — the kanban board + the **claude.ai session link** so I can review/steer from my phone.

**Implication:** The hard/novel part is #2 (the loop) and the #3 phone link via Remote Control. The board UI + storage + "move card" API is **commodity** — exactly what existing tools already give us. This biases us toward **reusing a board** and **building the orchestration loop**.

The orchestration loop's "move the card" calls are what the **API/MCP** requirement is for. Whoever owns the board owns that API.

---

## Zoom Level 1: Build vs Reuse vs Hybrid

Three top-level paths. Comparison first, then detail.

| Criteria                    | A. Build from scratch | B. Adopt/Fork Vibe Kanban     | C. Hybrid (OSS board + custom loop) |
| --------------------------- | --------------------- | ----------------------------- | ----------------------------------- |
| Time to working v1          | ✗ Weeks               | ✓✓ Days                       | ✓ ~1–2 weeks                        |
| Control over UX/columns     | ✓✓ Full               | ~ Their model                 | ✓ High (own loop, their board)      |
| Recurring/Notion intake     | Build it              | Build it (not native)         | Build it                            |
| Remote Control session link | Build it              | Likely partial native         | Build it                            |
| API/MCP for card moves      | Build it              | ✓ Native MCP                  | ✓ Board's API + thin MCP            |
| Maintenance burden          | ✗✗ All mine           | ~ Fork of dormant upstream    | ✓ Board maintained by its community |
| Learning value              | ✓✓ High               | ✗ Low                         | ~ Medium                            |
| Risk                        | Scope creep           | Upstream abandoned (Apr 2026) | Integration glue                    |

### Alternative A — Build from scratch

Build board UI, storage, card API/MCP, scheduler, and Claude Code runner myself.

**Pros:** Total control; columns/flow exactly as I want; great learning; no dependency risk; clean license.
**Cons:** Re-implements commodity board/API plumbing; slowest; high scope-creep risk; I maintain everything.
**Principle it serves:** Ownership & learning over speed.

### Alternative B — Adopt / Fork Vibe Kanban

Vibe Kanban (Apache-2.0, Rust+TS) already is a kanban board for orchestrating coding agents, with first-class Claude Code support, workspace-per-task, diff review, and an **MCP server**.

**Pros:** Closest existing match; fastest to working; MCP + Claude Code already wired; permissive license = free to fork.
**Cons:** Upstream company shut down ~Apr 2026 → community-maintained/dormant; its model may not match my exact 4-column + recurring-Notion + Remote-Control-link flow; Rust learning curve to modify; I inherit a codebase.
**Principle it serves:** Speed & "don't rebuild the commodity."
**Must verify before committing:** recent commit health, whether its MCP exposes card-move + a session-link field, whether it can host the _claude.ai Remote Control_ link (vs its own diff UI).

### Alternative C — Hybrid: reuse a board, build the orchestration loop

Take a permissive, API-first OSS board and build only the novel layer (intake + scheduler + Claude Code runner + a thin MCP wrapper for card moves).

Board candidates:

- **Backlog.md** (MIT) — tasks = markdown in git, **MCP built-in**, term+web kanban. Zero server DB. Great if I like git-native.
- **Kanboard** (MIT) — classic board, JSON-RPC API, plugins, very stable.
- **Planka** (v1.x AGPL) / **Vikunja** (AGPL) — nice boards + existing MCP servers, but copyleft.

**Pros:** Board is maintained by its community; I own the interesting part (the loop); pick license I like; smaller surface than full scratch build; not locked to a dormant fork.
**Cons:** Integration glue between my loop and the board's API; "move card" semantics constrained by the board; I still build intake/scheduler/runner/Remote-Control wiring (but that's the part I _want_ to own anyway).
**Principle it serves:** Reuse commodity, own the differentiator.

---

## Tradeoff Summary / My Read

- **Pure A** is rarely worth it unless learning is the _goal_ — most of the work is commodity.
- **B** is fastest but bets on a dormant upstream and a model that may fight my exact flow (recurring Notion intake, Remote Control link as the review artifact).
- **C** isolates risk: commodity board stays commodity; the differentiated orchestration loop is mine and decoupled from any single board (could even swap boards later).

**Tentative lean:** **C (Hybrid)**, OR **B if** a quick hands-on check of Vibe Kanban shows healthy code + the right extension points. The orchestration loop is identical work in both B-extended and C, so the decision is really "which board substrate."

---

## Decisions (resolved)

1. **Path:** Inspect **Vibe Kanban first** (B vs C pending its repo health + extension points). See [inspection](#vibe-kanban-inspection).
2. **"Need Review" session lifetime:** **Keep the local session alive.** Flow:
   - Card sits in Need Review with a live claude.ai Remote Control link.
   - On phone: open session → review → **chat with the agent for clarification**.
   - Exit is **either**: (a) I manually drag the card back to In Progress / Done, **or** (b) the **agent itself**, sensing review is complete, **calls the API/MCP to move its own card** automatically.
3. **Stack:** **TypeScript / Node** (Claude Agent SDK TS) for the orchestration loop.

### 🔑 Insight: the agent is itself an API/MCP client

The MCP server has **two kinds of clients**: the **scheduler** (creates/advances cards) _and_ the **running Claude Code session** (moves its own card, e.g. Need Review → In Progress/Done after I confirm). So every launched session is given the board MCP + its own card ID.

---

## Vibe Kanban Inspection (results)

| Dimension           | Finding                                                                                              | Verdict                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| License             | Apache-2.0                                                                                           | ✓ free to fork                                                 |
| **Health**          | **Officially SUNSETTING** (announced). Last release v0.1.44, Apr 24 2026. Community-maintained only. | ✗ dormant upstream                                             |
| Stack               | Rust backend (~50%) + TS/React frontend (~46%)                                                       | ⚠ board/MCP/status logic is in **Rust**; my loop is TS         |
| Model               | 3-stage **Plan → Prompt → Review**; "create, prioritise, assign issues on a kanban board"            | ~ adaptable to 4 cols, but it's their model                    |
| **MCP server**      | ✓ Ships one: `list_tasks`, `create_task`, `update_task_status` (+ workspace/issue tools)             | ✓ exactly the card-move API I need                             |
| Agent launch        | "Workspace per task" = git branch + terminal + dev server; supports Claude Code + 10 others          | ✓ but heavier than I need                                      |
| **Review surface**  | Its **own** built-in diff viewer + inline comments + integrated browser                              | ✗ **NOT** claude.ai/phone — conflicts with my core requirement |
| Recurring/scheduler | None                                                                                                 | ✗ build it anyway                                              |
| Session link        | Internal viewer only; no claude.ai Remote Control link                                               | ✗ build it anyway                                              |

### The decisive mismatch

Vibe Kanban's **biggest value-add is its own review UI** — but that's precisely the part I **don't want**: my review must be **claude.ai Remote Control on my phone**. So a fork would mean **ripping out its hallmark feature, grafting on Remote Control, modifying Rust, AND building the scheduler/Notion intake — all on a sunset codebase.** The only parts I'd reuse (board + move-card MCP) are the **commodity** parts that are cheap to build anyway.

**Verdict: USABLE-WITH-EFFORT, but a poor fork fit → recommend Path C (Hybrid).**

Useful takeaways to _borrow_ (not fork): its MCP tool shape (`list_tasks`/`create_task`/`update_task_status`) is a clean API contract to copy; "workspace per task" (git worktree per card) is a good isolation pattern.

### Knock-on insight: the board can be VERY thin

Because **all** review happens in claude.ai (free, native, phone-first), the board needs no diff viewer, no comment system, no integrated browser. It only needs: **columns + cards + a `session_url` field + an API/MCP to move cards.** That makes a **minimal custom board** genuinely cheap, and de-risks the "which OSS board" question.

---

## Decision needed: board substrate (Path C)

Now that review lives entirely in claude.ai, the board is thin. Options below — see next question to the user.

## Zoom Level 2: Architecture — _pending board-substrate choice_

---

## Zoom Level 2: Architecture of chosen path — _pending decision above_

## Zoom Level 3: Implementation details — _pending_
