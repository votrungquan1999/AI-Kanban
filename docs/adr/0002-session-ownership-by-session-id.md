# ADR 0002 — Sessions own cards by `sessionId`; `dedupeKey` is for imported cards only

- **Status:** Accepted — 2026-11-17
- **Deciders:** project owner
- **Context source:** card #568 and the feature spec [session-card-ownership-fix](../features/session-card-ownership-fix/spec.md)

## Context

On 2026-11-17 every `list_cards` call, from every conversation, failed with `E11000` on the `dedupeKey` index.

- **`dedupeKey` was built for imports.** Its partial unique index lets one source item (e.g. `notion:page-abc`) have at most one *open* card (todo, in_progress, need_review). The import feature never shipped, so nothing sets an import key today.
- **Session ownership reused it.** Session cards were keyed `session:<id>[:n]`, so the uniqueness rule also governed which card a conversation owns.
- **The two lifecycles disagree.** A session still owns its blocked and staled cards, but the index ignores those statuses. A parked card freed its key, a newer card from the same session took it, and moving the parked card back collided.
- **The read path turned one collision into an outage.** The blocked→review auto-move runs before every board read and had no error handling.
- **The key added nothing.** "Create card returns my existing card" already worked through a `sessionId` lookup, plus a local pointer file and hook on the client.

A heavier redesign was considered and rejected: a permanent `{sessionId, sessionSeq}` unique key, plus a lease that would stop two conversations writing one card. The board's job is tracking progress and decisions, and the outage didn't come from two conversations sharing a card.

## Decision

- **A session owns a card through `sessionId` alone.** Session cards carry `dedupeKey: null`. Idempotent `create_card` is the `sessionId` lookup over unfinished statuses, newest card first.
- **`dedupeKey` is reserved for imported cards** and keeps its open-status uniqueness and the `set_status` collision/force path.
- **`adopt_card` refuses while the session holds any unfinished card**, parked ones included, so `create_card` keeps returning the adopted card.
- **Automatic status moves on the read path skip a card that collides** and log it, so one card can never fail a read.

## Consequences

- **No status move can collide on a session card,** so this outage can't recur through session cards.
- **Negative:** two simultaneous `create_card` calls from one session could both create a card. A session calls tools one at a time, so this is accepted.
- **Negative:** nothing on the server stops two conversations working the same card. Ownership is advisory, as it was before. Revisit with a lease if that becomes a real problem.
- **Negative:** a colliding imported card stays parked and is logged on every read until someone resolves it. The import feature is dormant, so this is not expected in practice.
- **Migration:** the 299 existing `session:` keys were cleared on the live board after deploy.
