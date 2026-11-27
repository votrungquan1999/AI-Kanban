---
name: ai-kanban-track-session
description: Auto-tracks the current operator's (coding agent, non-coding agent, or human) work as a self-owned AI-Kanban card, whenever that work is worth revisiting a week from now — reuse an open card on the same repo when one covers it, otherwise create one in progress (tagged with the repo plus whatever scope is available, session id included only when one exists), append concise progress notes as the work advances, and hand it to review when done. Trigger automatically at the start of any task you would want a record of later, or when the user types "/ai-kanban-track-session", says "track this on the board", or "open a card for this work".
allowed-tools: Bash, mcp__ai-kanban-dispatch__create_card, mcp__ai-kanban-dispatch__list_cards, mcp__ai-kanban-dispatch__adopt_card, mcp__ai-kanban-dispatch__update_card, mcp__ai-kanban-dispatch__append_progress, mcp__ai-kanban-dispatch__append_decision, mcp__ai-kanban-dispatch__mark_decision_outdated, mcp__ai-kanban-dispatch__set_status, mcp__ai-kanban-dispatch__get_card_context
---

# AI-Kanban: Track This Session

You are an operator — a coding agent, a non-coding agent, or a human — who has just taken on a piece of real work. Nobody hands you a card id: **no card exists yet** — you create one to track your own work, drive it through the board, and hand it off for review when you finish.

The server owns the card's integrity and persistence; you reach it through the `ai-kanban-dispatch` MCP tools. **You** own judgment: deciding the work is worth tracking, naming it, choosing its tags, and writing progress notes a human can skim later.

## When to track (and when not to)

Open a card **automatically, without asking**, when you'd want to **revisit this work a week from now** — because it will still be unfinished, because a choice made inside it will be questioned later, or because someone has to pick it up where you left it.

A card is a **handoff device**. Work that ends the moment you deliver it, and that nobody ever returns to, produces a card no one reads — that is the noise to avoid. Note this is *not* a question of how many steps the work took: a long mechanical job can be finished and forgotten the same day, while a short open-ended one can still be live next week.

**Default to not tracking.** When you can't tell, don't open a card. The per-prompt hook asks again as the work goes on, and opening one late costs nothing — a card you never opened costs nothing either, but one you opened for finished work is on the board forever.

Re-check this test after about 8 prompts on one topic, and whenever a notes file gets written.

You decide this silently. Do **not** ask the user "should I track this?" — either track it and announce, or skip it. Asking whether to **reuse a card that already exists** is a different question, and an expected one — see `steps/1-open-card.md`.

## Inputs (gather these yourself)

- **Tags** — the **repo tag** is the one that matters, and it comes from `git`, never from `.ai-rules.json`. Add that file's `scope` entries as well when it exists. With no git repo and no scope to read, **ask the user** what tags to use.
- **Session id** — optional. If you're running as a session that has an id (e.g. a Claude Code session's `$CLAUDE_CODE_SESSION_ID`), include it. If not, omit it — the card is created without one.
- **Task name** — a short, human title you infer from the work (e.g. "Add staled-card auto-park"). Used as the card title.

## Flow

Each step has its own instruction file in this skill's `steps/` directory — read and follow it:

1. **Open or adopt the card** — `steps/1-open-card.md`: check four places before creating anything — the hook's "Active card #N" line, the pointer file, **the same task** on the board via `list_cards({ text })`, and **the neighbours** via `list_cards({ tags: [<repo tag>] })`. The first two are session-scoped and miss a card opened by a session that is no longer you; the third finds only the *same* task and misses the open card this work belongs under. Adopt what you find — a card from the hook line or pointer is already yours, so just carry on with it; a card found on the BOARD needs `adopt_card` + `set_status` to change hands. Only when all four come up empty do you gather tags (+ session id if one exists), infer a name, `create_card(...)` (it starts directly `in_progress`), write the `~/.claude/kanban-session-state/<sessionId>.json` pointer (best-effort, only when a session id exists), and announce it in one line.
2. **Track progress** — `steps/2-track-progress.md`: as the work reaches meaningful checkpoints, `append_progress(<id>, <note>)` with one concise note each. Don't narrate every keystroke.
3. **Hand off** — `steps/3-hand-off.md`: when the work is done (or you're parking it), `set_status(<id>, "need_review")`.

## Critical Rules

**DO:**
- **One card per unit of work, where the unit is the request you were handed** — not the deliverables inside it. Three things asked in one breath are one card with three items, however separable they look.
- **Search the board before creating, twice.** `list_cards({ text })` finds the *same* task — the hook line and the pointer file only know about *this* session, so a card opened by an earlier one is invisible to both, and a keyword search reaches `done`/`archived` where prior work usually sits. `list_cards({ tags: [<repo tag>] })` finds the *neighbours* — open work on this repo that this may belong under. Neither substitutes for the other.
- **Adopt, don't duplicate** — reuse a card you find rather than creating another, and `adopt_card` it so the board knows the work changed hands. A follow-up, a review fix, a next step, or a second attempt is the **same** task.
- **Resolve ambiguity yourself; escalate only what you can't undo.** Several plausible matches → verify the top-ranked one and take it. An `archived` match, or a card you can't adopt → ask the user. Those are the cases a wrong guess can't be walked back from.
- **Divergence is temporal, not a count of items.** Open a second card via `create_card({ …, forceNew: true })` only for work that surfaced **later** and isn't what the card was opened for. A request that listed several things is never grounds for several cards. Never `forceNew` because a compact lost your pointer, because the match is `done`, or because the search failed.
- Let the dispatch tools own card creation, status, and persistence.
- Keep progress notes short and state-bearing — what changed and where, not a transcript.
- Announce the card once, briefly (e.g. "Tracking this as card #N."), then get back to the work.

**DO NOT:**
- Ask the user for permission to track, or which card to use when the board is merely ambiguous — decide silently per the rules above. The narrow exceptions are an `archived` match, a card you can't adopt, a failed search, and the reuse question in `steps/1-open-card.md`.
- Track work you'd never go back to. Delivering a result is not the same as leaving something behind.
- Invent your own status values — use the board's own statuses (the tool enforces them). You may move a card between any two of them, same as a person on the webview.
- Read a failed board search as "no card exists" — an error means **unknown**. Stop and tell the user once rather than falling through to `create_card`.
- Silently continue untracked when the **critical** step fails — if `create_card` fails, **stop and tell the user**; card creation is not a fire-and-forget side channel.
- Conversely, block the actual work on a **non-critical** tracking failure — if `append_progress` or `set_status` fails, tell the user and keep working; those are the side channel, not the task.
