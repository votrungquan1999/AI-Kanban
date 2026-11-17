# Session card ownership

A conversation (session) owns its cards through `sessionId` alone. `dedupeKey` belongs to imported cards (`notion:…`). The automatic status moves that run before every board read can't fail the read.

## Why

On 2026-11-17 every `list_cards` call, from every conversation, failed with `E11000 … dedupeKey_1 dup key: { dedupeKey: "session:e9c877e8-…" }`.

- **Session cards used to be keyed `session:<id>[:n]`** in `dedupeKey`. Its partial unique index covers open statuses only (todo, in_progress, need_review).
- **A blocked card freed its key.** Card #548 was blocked; card #564 from the same conversation was opened and took the same key.
- **The read path moved #548 back.** `listCards` runs `reconcileBlockedCards` first; #548's 2-hour block had run out, so it was moved blocked → need_review. That collided with #564 and threw.
- **One card failed every read.** The reconcile is board-wide and had no error handling, so every conversation's read failed until #548 was re-keyed by hand.

The `session:` key never did anything the `sessionId` lookup didn't already do. "Create card returns my existing card" is `findActiveSessionCard`: `{sessionId, status ∈ in_progress | need_review | staled | blocked}`, newest by `number`.

## Behaviours

### The board keeps loading when one card's automatic move fails

- **Blocked → review:** a card whose move collides on `dedupeKey` stays blocked, is logged with `console.error`, and the rest of the board still moves and lists.
- **Staled → in progress on new activity:** a revive that collides returns `null`. The content write that triggered it (progress, decision, edit, workspace) still succeeds.
- **Only duplicate-key errors are caught.** Any other error still throws.

### A conversation's parked card comes back on its own after the conversation opened another card

- **Session cards carry `dedupeKey: null`.** `create_card`, including `forceNew`, never writes a `session:` key.
- **Collisions on conversation cards are impossible:** a blocked card reaching review, or a staled card reviving, never meets a key conflict.
- **Trade-off:** two simultaneous `create_card` calls from one conversation could both create a card. A conversation calls tools one at a time, so this is accepted.

### A conversation can't take over a card while it has an unfinished card of its own

- **`adopt_card` refuses with `ERR_DUPLICATE`** when the conversation holds any other card in in_progress, need_review, staled or blocked. That keeps its next `create_card` returning the adopted card.
- **Adopting clears a leftover `session:` key** and stamps `sessionId`. A card carrying an import key is still refused (`ERR_VALIDATION`).

### Imported cards keep their dedupe rule

- `createTask` with a `dedupeKey` still refuses a second open card for the same key.
- `set_status` still refuses a revive that collides, and `force: true` still displaces the open holder.

## Key files

- `src/cards/card.service.ts`: `insertSessionCard`, `findActiveSessionCard`, `ADOPTABLE_SESSION_STATUSES`, `listCards`.
- `src/cards/card.blocked.service.ts`, `src/cards/card.staled.service.ts`: the auto-moves.
- `src/cards/card.adopt.service.ts`: the take-over guard.
- `src/db/duplicate-key.ts`: `isDuplicateKeyError`.
- `src/db/indexes.ts`: the `dedupeKey` partial unique index (unchanged).

## Data

Cards created before this change carried `session:` keys. All 299 were cleared on 2026-11-17, after deploy, with `updateMany({ dedupeKey: /^session:/ }, { $set: { dedupeKey: null } })`. No card used an import key at the time.
