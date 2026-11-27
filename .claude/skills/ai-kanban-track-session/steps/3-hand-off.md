# Step 3: Hand Off for Review

When the work is finished — or you're stopping and want a human to look — move the card to review and leave it there.

## Action

Optionally append a closing progress note summarising the outcome, then:

```
set_status(<id>, "need_review")
```

You have full any-to-any parity with a person on the webview, so this works from wherever the card currently sits — including a card auto-parked into **Staled**. No intermediate hop is needed.

If the `set_status` call fails, report it and stop — don't loop. Tracking is a side channel; the actual work is already done.

## Interpret the result

- **Success** — the card now sits in **Need Review**, waiting on a human. Stop *tracking* and get back to the conversation.
- **Failure** — report the error to the user. Don't loop on it; the work itself is already done.

## Picking it back up

Handing off is not the end of the card. When review comes back with fixes — or the user asks for the next step on the same work — **continue on that card**:

```
set_status(<id>, "in_progress")
```

If you are resuming from an id you were handed rather than one you opened — a subagent passed it up, the user pasted `#114`, your pointer file is gone — `adopt_card({ id, sessionId })` first, for the same reason `steps/1-open-card.md` gives: until ownership moves, your own `create_card` can't see this card and will open a second one.

Then carry on as before, appending progress and handing off again when done. A review fix, a follow-up, or a second attempt is the **same** unit of work: opening a fresh card for it splits one piece of work across two, which is the duplication `steps/1-open-card.md` exists to prevent.

If you no longer have the card's id (a compact, a new session), find it the same way you would at the start — search the board, per `steps/1-open-card.md`.

## Don't

- Don't open a follow-up card for review feedback — reopen the existing one.
- Don't delete the card.
