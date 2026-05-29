# Bootstrap Prompt

> The single, **generic** prompt the runner injects into every Claude Code session. It does not contain the task — it teaches the agent how to fetch its task from the board, select repos with your confirmation, work safely, and pause for you. The same text is used for a fresh pickup and for a crash-restart.
> Parent: [design README](./README.md) · ties together: [scheduler-runner](./scheduler-runner.md) · [mcp-api-contract](./mcp-api-contract.md) · permission policy in [architecture](../brainstorm/brainstorm-ai-kanban-architecture.md#side-effect--permission-policy-decided)

---

## Why it must be generic + resume-aware

- **No task injection.** Server-mode Remote Control has no documented stdin task-injection (Spike #1). So we never bake the task into the prompt. The prompt is constant; the task lives on the board and the agent pulls it via `get_my_task()`. The board *is* the task queue.
- **Resume-aware.** Crash recovery auto-restarts a *fresh* session (scheduler-runner doc) — the chat transcript is gone but the worktree changes survive on the branch. The same prompt must therefore handle "start" and "continue" identically: **orient first, never redo finished work.**
- **Autonomy-first.** The agent runs headless and is steered from your phone. It works on its own and only pauses via the explicit protocol below.

## What the runner provides alongside the prompt

| Channel | Value | Purpose |
| ------- | ----- | ------- |
| env `CARD_ID` | card `_id` | which card this session owns (MCP is scoped to it) |
| env `IS_RESUME` | `true`/`false` | restart vs. first start (runner knows) |
| env `PARENT_DIR` | abs path to the repo container | where to scan for relevant sibling repos |
| `--add-dir PARENT_DIR` | — | read access so the agent *can* scan siblings (cwd alone is the empty workspace) |
| board MCP | `get_my_task`, `set_my_status`, `add_repo_to_my_workspace` | scoped to `CARD_ID` |
| `--allowedTools` | safe dev tools **+ the board MCP tools** | pre-approved so the agent acts autonomously (see [relationship](#relationship-to---allowedtools)) |

cwd is the empty `workspaces/card-<number>/`; worktrees appear under it as the agent adds repos.

---

## The prompt template

```text
You are an autonomous coding agent working a single card on an AI Kanban board.
You run locally but are monitored and steered from a phone via Claude Code Remote
Control. Work autonomously; involve the human only via the pause protocol (§5).

Your card id is in the CARD_ID environment variable. The board is both your task
queue and your control plane — you interact with it through the board MCP tools:
get_my_task, set_my_status, add_repo_to_my_workspace.

§1 ORIENT (always do this first)
- Call get_my_task() to read your assignment, current status, and the repos already
  in your workspace.
- Run git status in your working directory and any existing worktrees. If
  IS_RESUME=true you are CONTINUING interrupted work: file changes from before
  persist on your branch even though the earlier chat is gone. Never redo work that
  is already done — continue from the current state.

§2 SELECT REPOS (only if your workspace has no repos yet)
- Sibling repositories live under PARENT_DIR (read-only). Scan them and decide which
  are relevant to the task.
- Propose the list to the human and ASK FOR CONFIRMATION via the pause protocol (§5).
  Do not assume silently.
- After the human confirms, call add_repo_to_my_workspace(repo) for each. This
  creates an isolated worktree on branch aikanban/<card> inside your workspace.
  Only ever edit files inside these worktrees.

§3 DO THE WORK
- Make changes only inside your card's worktrees, on the aikanban/<card> branch.
  Commit as you make meaningful progress.
- Obey the prohibitions (§6) at all times.

§4 FINISH
- Task complete and you are confident → call set_my_status("done").
- Unsure / need a decision / want review → use the pause protocol (§5).

§5 PAUSE PROTOCOL (the only way to involve the human)
 1. Print a clear, self-contained message: what you did and/or exactly what you are
    asking. The human reads this on their phone.
 2. Call set_my_status("need_review").
 3. STOP — end your turn and wait. Stopping is what actually pauses you; the status
    move only surfaces the card to the human.
 When the human replies you resume: call set_my_status("in_progress") and continue
 from their input.

§6 PROHIBITIONS (never, unless the task explicitly instructs it)
- No writes/mutations to production databases. Use only a sandbox/test DB if provided.
- No git push, force-push, or deleting any branch other than your own aikanban/<card>.
- No side-effecting external calls (emails, third-party APIs, deleting cloud resources).
- Do not modify anything outside your worktrees — not the original repos under
  PARENT_DIR, not the board app.
```

This text is a draft to refine against real runs, but its **structure is the contract**: orient → select repos → work → finish, with the pause protocol and prohibitions as cross-cutting rules.

---

## The state machine the prompt enforces

The prompt makes the agent drive its own card through the board statuses (see [transition policy](./mcp-api-contract.md#status-transition-policy)):

```
spawned ──get_my_task──▶ in_progress
   (repos empty?) ──propose+pause──▶ need_review ──human confirms──▶ in_progress
                                                              │ add_repo_to_my_workspace ×N
   work ──question/decision/review──▶ need_review ──human replies──▶ in_progress
   work ──confident & complete──▶ done
```

**Repo confirmation is a real `need_review` bounce** — it surfaces on the board so you know the card wants you (a silent in-place wait would leave the card looking like it's working). This is consistent with "Need Review = human action required."

---

## Relationship to `--allowedTools`

Two layers, both required:

- **`--allowedTools` (hard, mechanical):** the *auto-approve* set — safe dev tools (read, edit-in-worktree, run tests/lint, git on the card branch) **plus the board MCP tools**, so the agent never blocks on a permission prompt for routine work or for moving its own card.
- **The prompt prohibitions (soft, judgment):** the *don't-do-this* list for irreversible/external actions that `--allowedTools` can't express granularly.

The prompt is the gate (per the autonomy-first permission decision); `--allowedTools` exists to keep the agent unblocked, not to gate.

---

## Open questions

1. **Delivery mechanism** — how server-mode Remote Control receives this initial prompt, and whether the session truly idles waiting after an "end turn" until a phone message arrives. Pins on the Spike #1 hands-on test.
2. **`IS_RESUME` necessity** — if `get_my_task()` + `git status` already make resume state obvious, the env flag may be redundant. Keep until the hands-on test says otherwise.
3. **Repo-confirmation friction** — every task bounces to `need_review` once up front to confirm repos. Acceptable now; revisit if it feels noisy (e.g. allow a recurring-def to pre-declare its repo set to skip the prompt).
4. **Prohibition specificity** — replace abstract "production databases" with concrete connection strings/resource names once the first real repos are wired (concrete rules are easier for the agent to honor).
