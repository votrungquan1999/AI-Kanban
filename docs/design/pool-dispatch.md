# Pool dispatch — Candidate 2′ operating model & slice scope

Refines the operational details left open by [ADR 0001](../adr/0001-execution-architecture-staged.md) for the **Candidate 2′** execution mechanism (reused interactive sessions + a `/ai-kanban-work-card <id>` skill). The ADR records *what* and *why*; this doc records the *operating model*, the *locked decisions*, and the *scope of the first implementation slice*, as settled in working sessions through 2026-05-31. Research backing: `RESEARCH_OUTPUT.md` (scratch, gitignored) and the brainstorm under [../brainstorm/](../brainstorm/brainstorm-execution-overview.md).

> **Revised 2026-05-31:** simplified from a per-session *worker identity + lease* to a pure **skill-driven** model. Sessions are generic and unidentified; a multi-file `/ai-kanban-work-card <id>` skill guides them. Git worktree creation is the **agent's** job (not code); the server only stores the agent's *declared* workspace state via an idempotent PUT-style tool. The card carries no `claimedBy`/`session`.

## Operating model

The system is designed to be driven **while the user is away from the machine**. What stays at home is a **running, fully-authenticated machine**; the user reaches it from a phone.

- **The pool is pre-started by a human, at home, before leaving.** A small number of interactive `claude` sessions are launched manually (in `tmux`/`screen` so they survive terminal close and disconnects), each authenticated against the Team Premium subscription with Claude Code **Remote Control** enabled. The machine must be kept awake (`caffeinate` / disable sleep) or the sessions freeze.
- **Remote Control connects the phone to an *already-running* session — it cannot spawn new ones.** So pool size is fixed at launch time; it is not grown on demand in this iteration.
- **Idle sessions are effectively free.** A `claude` session waiting for input burns no tokens until a card is dispatched to it, so pre-staging a few idle sessions is cheap headroom.
- **The human is the flow control.** The number of sessions opened and which card goes to which session are human decisions. There is no automated puller and no software-enforced concurrency cap.

## User flow

1. The user adds cards to **Todo** on the phone board (existing slice-1 behavior).
2. On the phone, the user copies a Todo card's **id**.
3. The user opens one of the pre-started sessions via its **Remote Control** URL and types **`/ai-kanban-work-card <id>`**.
4. The skill guides the session to: call **`claim_card(id)`** (atomic `todo → in_progress`); **create the git worktree(s) itself** using `git` in its own shell, following the skill's conventions and recovery guidance; then **declare** the resulting workspace via **`set_workspace(id, { workspacePath, repos })`**; then call **`get_card_context(id)`** to read the task.
5. The session works the card inside that worktree, one card at a time.
6. On completion the session calls **`set_status(id, "need_review")`** → the card moves to **Need Review** (or Done) and a `card_events` audit row is written.
7. The session **parks** on the card at Need Review — left alive and untouched — so the user can reopen that same session via Remote Control and steer it live.

## What is code vs. what is the agent

The split is by *who is better at it*:

- **Code owns integrity** — operations that must be atomic, consistent, and verifiable. These are MCP tools the agent calls; their *logic* is deterministic code, never improvised: the atomic claim (no double-assignment), reading context, status changes (honoring `transition-policy`), and persisting the declared workspace state (schema-validated). The agent **calls** these tools; it does not reinvent them.
- **The agent owns the messy real world** — `git` and the filesystem, where failure modes are open-ended (branch already exists, worktree path occupied, dirty tree, detached HEAD…). The agent runs `git` in its shell, reads the actual error, and recovers, guided by the skill's prose. No code wraps `git`. This is intentionally *not* automatically tested — its correctness rides on the skill + the model, with the human able to steer the parked session.

## Locked decisions

### Dispatch is human, by id, one card per session
The human picks the card (copies its id) and the session (which Remote Control URL to open). A session works exactly one card at a time. "Good enough for the current iteration" by explicit decision — full hands-off autonomy is Candidate 3, deferred.

### No software-enforced WIP cap
The claim does **not** check `count(in_progress) < N`, and there is **no** slot/worker registry collection. The pool size *is* the limit (enforced physically by how many sessions the human opened); `count(in_progress)` is the wrong number (a parked Need-Review card has left `in_progress` while its session is still busy); and it can't be made atomic anyway. A claim-time cap is only meaningful for the deferred auto-pull `/loop` variant.

### Skill-driven dispatch, no worker identity or lease
A pre-started session has no idea which card it will work until `/ai-kanban-work-card <id>` arrives, so it cannot be `CARD_ID`-scoped. Dispatch is driven by the **skill**, not by tagging sessions with an identity in code:
- Sessions are **generic and unidentified.** No `WORKER_ID`; the card carries no `claimedBy`/`session` field.
- The MCP server is **generic and non-card-scoped**; its tools take the card **id as an argument**: `claim_card(id)`, `get_card_context(id)`, `set_status(id, …)`, `set_workspace(id, …)`.
- There is **no lease and no `ERR_FORBIDDEN`.** The human controls which session gets which id, and the atomic claim already prevents double-assignment, so a code lease would duplicate a guarantee we already have. Guide via the skill, don't hard-gate.

### Atomic claim is a dedicated operation
`todo → in_progress` is not a legal edge for non-UI callers in `transition-policy`, so the claim cannot route through `updateTaskStatus`. It is a dedicated atomic op (new `src/cards/card.claim.service.ts`), `claimCard(id)`: a single `findOneAndUpdate({_id, status:"todo"}, {$set:{status:"in_progress", runState:"running", pickedAt}, $inc:{attempts:1}})` → the after-image, or `null` to the loser. It records *that* the card was claimed, not *who*. That single-doc flip **is** the no-double-assignment guarantee. A successful claim emits a `card_events` audit row.

### Workspace state is declared, not appended (idempotent PUT)
The agent creates the worktree(s) itself, then **declares the complete resulting state** via `set_workspace(id, { workspacePath, repos })`, which **replaces** the card's workspace bookkeeping (not append). Because it is replace-not-merge, re-sending the same state is **idempotent** — there is no "already added" case to reject, so **no `ERR_REPO_ALREADY_ADDED` / `ERR_REPO_NOT_FOUND`**. The only integrity the server enforces is **schema shape** (each `repos[]` entry is a well-formed `{repo, branch, worktreePath}`; bad shape → the existing `ERR_VALIDATION`). The agent is the source of truth for what is on disk; the server records its declaration. *Gotcha baked into the skill: the agent must send the **full** set each call, or it would wipe the others.*

### Review = park, no new persistence
Reaching Need Review is the existing status transition (now via the id-argument `set_status` tool). Parking is a runtime/human behavior; no new persistence in this slice.

## The `ai-kanban-work-card` skill is multi-file (and centrally managed)

The skill is authored in the central **AI-rules-repo** (`skills/claude-code/ai-kanban-work-card/`), where all skills live; AI-Kanban subscribes via its `.ai-rules.json` `skills[]` and the user syncs it into `.claude/skills/`. Because each project selects its own skills, this AI-Kanban-specific skill lives centrally yet only AI-Kanban pulls it. Claude Code only for now.

Following the `orchestrated-feature-dev` `nodes/` convention (a thin `SKILL.md` that points at focused instruction files), it is split so the messy worktree step gets its own file:

- `SKILL.md` — frontmatter (name, description, `allowed-tools` = the four MCP tools **+ Bash**) + a prose `<id>` usage line (no frontmatter argument key) + the high-level flow that references each step file.
- `steps/1-claim.md` — call `claim_card(id)`; if it returns nothing, stop and report (already taken / not found).
- `steps/2-prepare-worktrees.md` — the **git procedure** + conventions (branch `aikanban/card-N`, path `workspaces/card-N/<repo>`) + recovery guidance (branch exists → attach; path occupied; dirty tree), then call `set_workspace(id, …)` with the **full** set.
- `steps/3-work-and-complete.md` — call `get_card_context(id)`; do the work; on completion `set_status(id, "need_review")`; park.

## Pool operations (operational, documented — not code in this slice)

- Start the pool **manually at home** before leaving: launch each generic `claude` session in `tmux` with Remote Control enabled.
- Keep the machine awake (`caffeinate` / sleep disabled).
- If a session crashes or exits mid-day, that session is gone until the user can restart it — accepted limitation (no remote re-provisioning).

## Deferred (later slices, gated on the June-15 billing probe)

- **Per-session identity / lease** — only if a future mode needs to *enforce* that one session can act on a card (e.g. fully autonomous auto-pull with no human gating).
- **Remote pool provisioning** — SSH-from-phone, or a local "pool server" the phone POSTs to. That makes *software* spawn `claude` — the **Candidate 3 / A-1 billing bet** — defer until verifiable post-June-15.
- **Crash recovery / stale sweep** — reset dead-session `in_progress` cards to `todo` (needs `pickedAt` + TTL).
- **Auto-pull `/loop` variant** — software pulls "next card," which reintroduces a real WIP cap.
- **Candidate 3** — fresh interactive `claude` per card under a pty for full hands-off autonomy.

## What this slice builds vs. reuses

- **Reused** (slices 1–3): card CRUD, `updateTaskStatus` and its `transition-policy`, the status-write + `card_events` completion logic, parse-on-read Zod doc schemas (and the existing `ERR_VALIDATION`/`ERR_NOT_FOUND`/`ERR_INVALID_TRANSITION`), counters, the in-memory Mongo test harness, and the existing `CARD_ID`-scoped MCP server/tools — left intact and additive. **Git is run by the agent** (no new code).
- **Net-new**: the atomic `claimCard(id)`; the `workspacePath`/`repos[]` card fields (+ lockstep type/schema/mapper edits); the idempotent `setWorkspace(id, …)` persistence; the generic dispatch MCP server (id-argument `claim_card`/`get_card_context`/`set_status`/`set_workspace` tools — no `WORKER_ID`, no lease) + its no-identity stdio entry; and the multi-file `ai-kanban-work-card` skill (authored in AI-rules-repo `skills/claude-code/`, subscribed via AI-Kanban `.ai-rules.json`, synced into `.claude/skills/`). **No new error codes.**
