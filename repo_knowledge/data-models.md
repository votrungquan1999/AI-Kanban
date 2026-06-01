# Data Models

Persistence is **MongoDB** via the **native driver + Zod** (no ODM). Authoritative design: [docs/design/data-model.md](../docs/design/data-model.md). This file captures what is actually built and the non-obvious decisions.

## Collections

| Collection | Status | Purpose |
| --- | --- | --- |
| `cards` | **built** | the board cards (the central entity) |
| `card_events` | **built** | append-only audit log of card lifecycle actions |
| `counters` | **built** | monotonic sequence for human-readable `number` |
| `recurring_defs` | design-only | recurring intake definitions |
| `sources` | design-only | external task origins (Notion, repo sets) |

Typed accessors live in `src/db/collections.ts` (`cardsCollection`, `cardEventsCollection`, `countersCollection`).

## `cards` (`src/cards/card.type.ts`)

Two distinct types (per the project's type-separation rule): **`CardDocument`** (DB shape, `_id`/`ObjectId`/`Date`) and **`Card`** (client shape, `id`/hex/ISO strings). Conversion is `toClientCard` in `src/cards/card.mapper.ts` — raw documents are **never** exposed.

Key fields: `number` (monotonic, drives branch `aikanban/card-N`), `title`, `description?`, `status` (the four columns), `priority`, `origin` (discriminated: `manual` | `recurring`+defId), `dedupeKey`, an embedded `repos[]` (`{repo, branch, worktreePath}`), `workspacePath`, plus **runtime fields** (`runState`, `process`, `attempts`, `restarts`, `nextStartAfter`, `lastError`, `pickedAt`, `finishedAt`) that are set to defaults on create — **no logic is built around the runtime fields in the current slices** (they exist for the design-only scheduler/runner).

Non-obvious decisions:
- `repos` is **embedded** (bounded, owned by card, always read together) — not a separate collection.
- `origin` is a **discriminated subdocument** (`origin.type` is queryable), not a string.
- `number` is a separate human-readable id because an ObjectId is unwieldy in a git branch name.

## `card_events` (`src/cards/card-event.type.ts`, `card-event.service.ts`)

Append-only audit log emitted from the `createTask` / `claimCard` / `updateTaskStatus` choke points. Shape: `{cardId, from, to, caller, at, outcome, error}`.

Non-obvious decisions:
- **Separate collection, not embedded history** — keeps card-move updates touching disjoint fields and lets the log grow unbounded.
- **`outcome` + `error` discriminator** — distinguishes a rejected move from a success (and a `failure` with `from=null` NotFound from a `success` create with `from=null`).
- **Emits on both success and failure** — every successful transition AND every rejected transition (InvalidTransition / NotFound) writes a row.
- Read-back (`listCardEvents`) sorts `{ at: 1, _id: 1 }` for deterministic, insertion-ordered same-millisecond events.

## Counters / human-readable IDs (`src/cards/counters.ts`)

MongoDB has no auto-increment. `nextNumber(db)` does a single `$inc` upsert on `{ _id: "cards" }` returning `seq` — atomic, gap-free-enough, concurrent-safe.

## Indexes (`src/db/indexes.ts`)

- `cards`: `{ status, priority: -1, createdAt }` (column reads + pickup ordering), `{ number }` unique, `{ dedupeKey }` unique **partial** (only open statuses — never two open cards for one source item; closed ones may repeat).
- `card_events`: `{ cardId, at }` (chronological audit read-back).

## Concurrency patterns (MongoDB-specific)

These replace SQL transactions; all rely on **single-document atomicity**:
- **Atomic claim** — `claimCard` (`src/cards/card.claim.service.ts`) does one `findOneAndUpdate({_id, status: todo}, {$set: in_progress/running/pickedAt, $inc: attempts})`. That single filtered flip **is** the no-double-assignment guarantee; the loser gets `null`. It records *that* the card was claimed (a success audit row), not *who* — there is no owner/`claimedBy` field and no lease (the human controls dispatch; see [pool-dispatch.md](../docs/design/pool-dispatch.md)).
- **Card moves** are single-doc updates → inherently atomic. `updateTaskStatus` constrains non-UI callers by filtering the update on legal source statuses (`$in`), so an illegal move simply matches nothing.
- **Dedupe on intake** relies on the partial unique index: treat a duplicate-key (E11000) error as "already queued" → `ERR_DUPLICATE`.

## Parse-on-read layer (`src/db/find-z.ts`) — important

All reads go through thin wrappers — `findOneZ` / `findManyZ` / `findOneAndUpdateZ` — that `safeParse` every returned document against a Zod **document** schema (`cardDocumentSchema`, `cardEventDocumentSchema`). On schema drift they log the Zod issues and **throw `AppError(ERR_SCHEMA_DRIFT)`** rather than letting a malformed doc flow downstream. This caught the `ignoreUndefined` bug class (an omitted `description` persisting as BSON `null`). Note the one deliberate exception: `updateTaskStatus` reads its pre-image with a **raw** `findOne` (not `findOneZ`) so drift can't mask NotFound/InvalidTransition.
