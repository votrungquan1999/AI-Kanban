# AI-Kanban tracking hook

A `UserPromptSubmit` hook that keeps AI-Kanban tracking deterministic: every prompt is
re-evaluated by the harness (not the model's memory), and the model is reminded where to
record what happened. The hook itself records nothing — it only instructs. It also names
the session: see [Session naming](#session-naming).

## Install (manual drop-in)

1. Copy `kanban-track.mjs` into the target project's `.claude/hooks/kanban-track.mjs`.
2. Deep-merge the contents of `settings-fragment.json` into the project's
   `.claude/settings.json` under the `hooks` key (append to `hooks.UserPromptSubmit`,
   don't overwrite an existing array — preserve any hand-written hooks already there).
3. No other configuration is required. The hook makes no network calls and reads no
   credentials — recording is done by the model through its own MCP tools.

## Runtime convention: the session pointer

The hook reads a per-session pointer file to know which AI-Kanban card is currently
active for the session:

```
~/.claude/kanban-session-state/<session_id>.json
```

```json
{ "cardNumber": 42, "cardId": "<24-hex ObjectId>", "summary": "short card summary" }
```

- Written by the model right after `create_card` (and overwritten whenever the model
  opens a new card because the task diverged).
- `cardNumber` + `summary` are shown to the user in the hook's reminder text.
- `cardId` is the 24-hex Mongo ObjectId the model passes to `append_progress` /
  `append_decision` — validated by the hook, but never emitted or shown to the user.
- No pointer for the session = no active card; the hook reminds the model to open one only
  if the work is worth revisiting a week from now, and to check the repo's open cards first.

## Behavior per prompt

1. Read stdin (`session_id`, `transcript_path`, `prompt`, `cwd`).
2. Look up the pointer for `session_id`.
   - No pointer → emit an "open a card only if you'd revisit this in a week, and check the
     repo's open cards first" reminder. Asked retrospectively, so it re-fires as work grows.
   - Pointer present → emit the active card # + summary, the recording routes below, and
     "open a new card only on genuine divergence (`forceNew`)".
3. Read the transcript for the session's name (below): return a declared name as
   `sessionTitle`, or append the naming ask while the session has no name.
4. Exit 0. Always — exit 2 would erase the user's prompt.

## Recording routes the reminder carries

The model records, not the hook — a verbatim prompt dump captures what was *typed*, not
what *happened*. The reminder is conditional ("if something notable just happened"), since
it fires on every prompt and an unconditional ask only trades verbatim noise for
model-generated noise. Routes, all relative to the model's own task workspace:

- a **decision** (with why) → `append_decision` + `DECISIONS.md`
- a **step** finishing or starting → `IMPLEMENTATION_PROGRESS.md`
- an **open question**, a **finding**, or a **reusable command** → `JOURNAL.md` (append)

The hook never names an absolute path: it receives only `session_id` and `cwd`, never the
workspace, and it writes nothing outside the model's own task folder.

## Session naming

Only Claude Code can name a session — the model cannot type `/rename`. A
`UserPromptSubmit` hook can, by returning `hookSpecificOutput.sessionTitle`; Claude Code
records it as a `custom-title` transcript entry, exactly like `/rename`.

- **The model declares**: once it knows the task, it writes a plain line
  `Session name: <3-6 words>` in a reply. Only assistant text blocks count.
- **The hook applies** the latest declaration on the next prompt, card or no card.
- **A manual `/rename` wins**: a declaration older than the last title *change* is ignored.
  Claude Code re-appends the current `custom-title` repeatedly, so a repeat is not a change.
- **The ask** ("This session has no name yet…") is appended to the reminder until the
  transcript holds a title, and is skipped on the prompt that applies one.
- **Cost**: the transcript is read on every prompt, but only lines containing the marker or
  `"custom-title"` are JSON-parsed.
