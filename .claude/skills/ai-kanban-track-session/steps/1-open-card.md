# Step 1: Open (or Adopt) the Card

Get one card tracking this work — **adopt the session's existing card if there is one, otherwise create it** — then announce it.

## First: is a card already active for this session?

Tracking must be **idempotent** — one card per unit of work, even across a context compaction. Before creating anything, check whether this session already owns a card:

1. **The hook reminder.** The `UserPromptSubmit` hook injects one of two lines each turn:
   - `Active AI-Kanban card #N (<summary>). …` → a card already exists. **Adopt it** — skip creation, keep its id/number, go straight to `steps/2-track-progress.md`.
   - `No AI-Kanban card is active for this session. …` → none yet; continue below to create one.
2. **The pointer file** — the durable record that survives a compact (see below). If `~/.claude/kanban-session-state/<sessionId>.json` exists and has `cardId`/`cardNumber`, that IS your active card. Adopt it.

Only when **neither** shows an active card do you create one.

> The dispatch server is also idempotent as a backstop: calling `create_card` again for a session that already has a live card returns THAT card, not a duplicate. But check first anyway — it's cheaper and keeps your announcement honest.

## Gather the inputs (only when creating)

1. **Tags** — if you're in a repo with an `.ai-rules.json` at its root, its `scope` array is a good default. Otherwise (no such file/key, or not in a repo), **ask the user** which tags to use.
2. **Session id** — optional. If you're a session with an id (e.g. `$CLAUDE_CODE_SESSION_ID`), include it — it's what makes tracking idempotent and compact-proof. No session id → omit the field; do not stop or ask for one.
3. **Task name** — a short imperative title inferred from the work (e.g. "Add staled-card auto-park").

## Action

```
create_card({
  title: <task name>,
  description: <one-sentence goal, optional>,
  tags: <the tags gathered above>,
  sessionId: <session id, only if one exists — omit the key otherwise>,
})
```

The card is created **directly in `in_progress`** — no separate claim step. The tool returns the card (number `#N` + id); keep the id for the rest of the session.

### When the work genuinely diverges

If, later in the same session, the work splits into a **distinct task** that deserves its own card (not a continuation of the current one), call `create_card` again with `forceNew: true`. That — and only that — opens a second card for the session; then repoint the pointer file (below) at the new card. Do **not** pass `forceNew` just because you lost track after a compact; that's what the adopt check is for.

## Write the session pointer

If a session id exists, write the pointer right after `create_card` succeeds (and rewrite it whenever `forceNew` opens a new card). This is the **memory that persists through a compaction** — downstream hooks/skills resolve the active card from it, and a resumed session re-reads it instead of assuming no card exists:

```
~/.claude/kanban-session-state/<sessionId>.json
```

```json
{ "cardId": "<created card id>", "cardNumber": <created card number>, "summary": "<task name>" }
```

Best-effort — a failed write must not block card creation; note it and move on. No session id → skip this step.

## Announce it

Tell the user in **one line** — `Tracking this as card #N.` (created) or `Continuing on card #N.` (adopted). Then get back to the work.

## Interpret the result

- **Adopted / created** — you have a card id and number. Continue to `steps/2-track-progress.md`.
- **Creation failed** — card creation is the **critical** step; **stop and surface the error** to the user (retry, fix the board, or explicitly proceed untracked). Do not silently continue untracked.
