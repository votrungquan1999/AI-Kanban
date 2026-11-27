# Step 2: Track Progress

As the work advances, leave a short trail on the card so anyone (including a future resumed session) can see where things stand.

## When to append a note

Append at **meaningful checkpoints**, not on every action — e.g. a step finished, a blocker hit, a plan changed. A good rule of thumb: if you'd mention it in a standup, it's worth a note.

Do **not** append a note for every tool call or edit. A card with fifty micro-notes is as useless as one with none.

## Action

```
append_progress(<id>, <note>)
```

Each call adds one timestamped note to the card's history (earlier notes are preserved) and bumps the card's `updatedAt` — which also keeps the card from being auto-parked as stale.

If an `append_progress` call fails, tell the user and keep working — tracking is a side channel, never a blocker for the actual task.

## Re-stamp the mirror baseline

After a **successful** `append_progress` (or `append_decision`), update `lastMirroredAt` to the current ISO timestamp in `~/.claude/kanban-session-state/<sessionId>.json`, preserving the file's other fields.

This is what clears the `flush-debt` nudge: it compares your notes folder's file mtimes against this timestamp, so a stamp that lags behind reports work as unmirrored when it isn't — and re-mirroring in response would duplicate entries on the card. **Only stamp when the call actually succeeded**; on failure, leave it, so the debt correctly stays visible. Best-effort and never blocking, like the pointer write itself.

## Writing a good note

- **One line, state-bearing.** What changed and where — e.g. `Staled reconcile service done + wired into board read; UI next.`
- **Carry state forward.** Write what a resumed session would need to know to continue, not a narrative of what you did.
- **No secrets, no noise.** Skip transcripts, raw logs, and obvious restatements of the title.

## Log a decision

A decision is a different signal from a progress note: progress is *what changed and where*, a decision is *the why behind a choice*. Log one at a **real decision point** — a non-trivial choice, tradeoff, or reversal — not every step:

```
append_decision(<id>, <decision>, <why>)
```

`decision` is capped at **200 characters** and `why` at **400**. Over that the call is refused with `ERR_VALIDATION` naming the actual length — rewrite it shorter and call again. Do not treat that refusal as a failed mirror to skip past: skipping it loses the decision entirely.

If a later decision reverses an earlier one, mark the old one outdated so the log stays honest:

```
mark_decision_outdated(<id>, <index>, <supersededByIndex>)
```

If a moment is genuinely both a state change and a decision, log both — but don't restate the same text in each; the progress note carries the state, the decision carries the why.

## Keeping the card warm

An `in_progress` card untouched for 3 hours is auto-parked into **Staled** on the next board view. A genuine progress note resets that clock. If you resume a parked (Staled) card, move it back with `set_status(<id>, "in_progress")` before continuing, then keep appending notes.

When the work is complete (or you're parking it for review), continue to `steps/3-hand-off.md`.
