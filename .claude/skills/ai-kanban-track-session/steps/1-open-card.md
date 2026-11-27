# Step 1: Open (or Adopt) the Card

Get one card tracking this work — **adopt the session's existing card if there is one, otherwise create it** — then announce it.

## First: is a card already active for this session?

Tracking must be **idempotent** — one card per unit of work, even across a context compaction. Before creating anything, check whether this session already owns a card:

1. **The hook reminder.** The `UserPromptSubmit` hook injects one of two lines each turn:
   - `Active AI-Kanban card #N (<summary>). …` → a card already exists. **Adopt it** — skip creation, keep its id/number, go straight to `steps/2-track-progress.md`.
   - `No AI-Kanban card is active for this session. …` → this session has none. That is NOT "no card exists" — keep going down this list.
2. **The pointer file** — the durable record that survives a compact (see below). If `~/.claude/kanban-session-state/<sessionId>.json` exists and has `cardId`/`cardNumber`, that IS your active card. Adopt it.
3. **The same task on the board** — see the next section. Both checks above are session-scoped, so both miss the common case: the work has a card, opened by a session that is no longer you.
4. **The neighbours on this repo** — see *Before creating: what else is open on this repo?* below. The keyword search only recognises the work you are about to do; it cannot see the open card this work belongs **under**.

Only when **all four** come up empty do you create one.

> The dispatch server is also idempotent as a backstop, but only for the *same* session id: calling `create_card` again for a session that already has a live card returns THAT card. It cannot recognise a card opened by a different session — that is what the board search is for.

## Then: does the board already have a card for this work?

A pointer is session-scoped and easily lost — a compact, a restart, a different machine, a session resumed under a new id. Every duplicate cluster this rule exists to prevent was opened by an agent that had no pointer and never looked at the board.

```
list_cards({ text: "<the distinctive words of this work>" })
```

- **It reaches finished work.** A keyword search spans every status, including `done` and `archived` — the card you want is often already closed. Do **not** pass `status` yourself; that narrows it back and hides exactly what you're looking for.
- **Don't add `tags`** (or any other filter). Tags narrow the search, and a card tagged differently at creation then silently doesn't match — a zero-result you'd read as "no card exists".
- **Phrase-quote an exact id.** Send `text` with the quotes *inside* the value — the string the tool receives must be `"RISE-14881"`, quote marks and all — and it matches only that whole ticket id. Unquoted, `RISE-14881` also matches any card containing `rise` or `14881` on its own.
- **Results are ranked best-first**, so judge the top few rather than scanning everything.
- **Verify before adopting.** Run `get_card_context(<id>)` on the best match and read it. Same work, or just similar words?

**A follow-up is the same task.** A review fix, the next step of a plan, a second attempt after a failure, "now do X to the thing we just built" — all continue the existing card. Only genuinely different work deserves a new one.

### What to do with what you find

- **One clear match** — adopt it (next section), even if it is `done`.
- **Several plausible matches** — verify the top-ranked one with `get_card_context` and adopt it if it is the same work. Results are relevance-ranked, and multiple hits are normal today because the old duplicate clusters are still on the board; stopping to ask on every one would put a question at the start of most tasks. Only escalate if the top hit turns out NOT to be this work and you cannot tell which is.
- **Any match is `archived`** — **stop and ask the user**, even if it is the only one. Someone archived it deliberately, and resurrecting it is not yours to decide.
- **No match** — create one, per the rest of this file.
- **The search errored** — that is not "no match". See *If the search itself fails* below.

### If the search itself fails

`ERR_SEARCH_UNAVAILABLE` — or any error result — means the board could not answer. It does **not** mean no card exists. Treat it as unknown:

1. Retry once with an explicit all-status filter and no `text` — `list_cards({ status: ["todo", "in_progress", "need_review", "blocked", "staled", "done", "archived"] })` — and scan it yourself. Listing still works when search is broken, but **only an explicit filter reaches `done`/`archived`**; a bare `list_cards()` hides exactly the finished cards you are looking for.
2. If that doesn't settle it, **stop and tell the user once**: search is unavailable, so an existing card can't be ruled out. Ask whether to open a new card anyway or carry on untracked.
3. If they say tracking isn't needed, carry on untracked — and don't retry the search every turn.

Never fall through from a search error to `create_card`. That is precisely how one unit of work becomes five cards.

## Before creating: what else is open on this repo?

The keyword search answers *"has someone already opened a card for this exact task?"*. It cannot answer *"is there open work here that this belongs to?"* — and that second miss is what turns one request into three cards.

Derive the repo tag from **git**:

```
git rev-parse --show-toplevel     # its basename is the repo tag
```

Not from `.ai-rules.json`. That file is absent in many repos, and where it exists its `scope` is often just `personal`, which names no repo — use its entries as extra tags, never as the repo identity.

Then list what is open there:

```
list_cards({ tags: [<repo tag>] })
```

Pass no `status`: the default already hides `done`/`archived`, and finished cards are exactly the ones you must not pile new work onto.

### What to do with the neighbours

- **Nothing open** — create, per the rest of this file.
- **Something open and plausibly related** — surface it and ask, picking the best **one or two**, never the whole list:

  > #145 is still open on quant-trading ("prune ML artifacts, fix picker sort order"). Why isn't it done — should this work go there instead?

  The question does double duty: it stops the split, and it puts a parked card in front of the user at the one moment they would act on it.
- **Open but clearly unrelated** — don't ask. A question with no plausible candidate is the interruption this skill exists to avoid.

### Reuse or split

Default to **reuse**:

- **It piles on top of that card's subject** — another item in the same area, the next slice, a defect in what it built → reuse it. `update_card` to add the item, then `append_progress` with what you're starting.
- **It is a genuinely different task** that happens to share a repo → new card.

A repo is a coarse key, and several unrelated threads legitimately live on one. The tag finds candidates; it never decides for you.

## Adopting a card the board already has

The card exists, but it belongs to the session that opened it. In this order:

1. **`adopt_card({ id, sessionId })`** — moves ownership to you. Without it the board still thinks the old session owns the card, so your own later `create_card` won't recognise it and will open a second one.
2. **`set_status(<id>, "in_progress")`** — a parked or finished card isn't active until you move it.
3. **`update_card({ id, … })`** — set `nextAction` to what you're about to do, and **add** this stint to `description` rather than replacing it. The search index covers title + description only, so overwriting the original wording deletes the terms the next session will search for — the ladder degrades itself one adoption at a time.
4. **Write the pointer file** (below) and `append_progress` one line recording that you picked this card up and why it's the same work.

**No session id?** `adopt_card` needs one, so skip step 1 and do the rest — the card is yours to work, it just carries no session ownership, exactly like a card you'd have created without one. Do not let this send you to `create_card`.

`ERR_DUPLICATE` means different things depending on which call returned it:

- **From `adopt_card`** — this session already holds an unfinished card of its own (in progress, in review, staled or blocked), or another session adopted this one first. Resolve it with the user; don't force it and don't open a third card.
- **From `set_status`** — only an imported card (one carrying an import key such as `notion:page-1`) can collide: another open card holds the same import key. Take it to the user; `force` displaces that other card, so use it only with their OK.

`ERR_VALIDATION` from `adopt_card` means the card isn't adoptable: a `todo` card belongs to `claim_card`, and a card carrying an external key (e.g. `notion:page-1`) must not be re-keyed at all — leave it alone and tell the user.

## Gather the inputs (only when creating)

1. **Tags** — the git-derived **repo tag** you already resolved in *Before creating: what else is open on this repo?*, plus the `scope` entries from `.ai-rules.json` when that file exists. The repo tag is what makes the next session's neighbour lookup work, so a card without one is a card the ladder cannot find. Outside a git repo and with no scope to read, **ask the user** which tags to use.
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

Divergence is **temporal**: work that surfaces *later* in the session and isn't what the card was opened for. If that happens, call `create_card` again with `forceNew: true` — that, and only that, opens a second card for the session; then repoint the pointer file (below) at the new card.

**A request that listed several things is not divergence.** Three features named in one breath are one unit of work: one card, three items in its description, `nextAction` on the first. Item count says nothing about how many cards the work needs.

`forceNew` is for genuine divergence, never for convenience. Do **not** reach for it because:

- the ask had several parts — see above; that is one card;
- a compact made you lose track — that's what the four checks above are for;
- the board search found a card you'd rather not reuse — adopt it, or ask the user;
- the match is `done`, or parked in `need_review`/`staled`/`blocked` — a follow-up on finished or parked work is still that work; adopt and reopen it;
- `adopt_card` or `set_status` returned `ERR_DUPLICATE` — that's a conflict to resolve with the user, not a reason to open a third card;
- the search errored — you don't know whether a card exists, so you can't know this is divergence.

## Write the session pointer

If a session id exists, write the pointer as soon as you have a card — right after `create_card` succeeds, right after you adopt one, and again whenever `forceNew` opens a new card. This is the **memory that persists through a compaction** — downstream hooks/skills resolve the active card from it, and a resumed session re-reads it instead of assuming no card exists:

```
~/.claude/kanban-session-state/<sessionId>.json
```

```json
{
  "cardId": "<created card id>",
  "cardNumber": <created card number>,
  "summary": "<task name>",
  "workspacePath": "<absolute path to the task/notes folder, if one exists>",
  "lastMirroredAt": "<ISO timestamp of this write>"
}
```

**`workspacePath` is the task/notes folder** — the one holding `IMPLEMENTATION_PROGRESS.md` and `DECISIONS.md`. It is **not** cwd (often a container of many sibling repos) and **not** a code worktree (those are the card's `repos[].worktreePath`). One task spanning several repos still has a single notes folder, so this stays a single path. Omit the field entirely if the work has no notes folder — never guess one.

**`lastMirroredAt`** is the baseline the `flush-debt` hook compares workspace file mtimes against, to spot records that exist only in a folder you may delete. Set it on this first write, then **re-stamp it every time you mirror to the card** (see `2-track-progress.md`). Both fields omitted is fine and normal — the hook stays silent rather than guessing.

Best-effort — a failed write must not block card creation; note it and move on. No session id → skip this step.

## Announce it

Tell the user in **one line** — `Tracking this as card #N.` (created) or `Continuing on card #N.` (adopted). Then get back to the work.

## Interpret the result

- **Adopted / created** — you have a card id and number. Continue to `steps/2-track-progress.md`.
- **Creation failed** — card creation is the **critical** step; **stop and surface the error** to the user (retry, fix the board, or explicitly proceed untracked). Do not silently continue untracked.
- **Search failed, user hasn't decided** — you have no card and must not invent one. Wait for their answer rather than proceeding either way.
