# Data Model — MongoDB

> Persistence is **MongoDB** (replacing the brainstorm's SQLite→Postgres). This doc defines collections, embedding choices, indexes, and the concurrency-safe update patterns the loop relies on.
> Parent: [design README](./README.md) · source model: [architecture](../brainstorm/brainstorm-ai-kanban-architecture.md#data-model-draft)

---

## Why MongoDB fits here

- **Single-document atomicity** covers the loop's hottest operation — moving a card between columns is one `findOneAndUpdate` on one doc, atomic with no transaction needed.
- **Embedded arrays** model a card's chosen repos naturally (1-card-to-few-repos, always read together, never queried alone).
- **Schema-flexible** `origin` / `source_config` / `select_rule` shapes vary by kind without migrations.
- Solo, local-first: a single `mongod` (Docker) or Atlas free tier is enough.

---

## Collections

Four collections: **`cards`**, **`card_events`**, **`recurring_defs`**, **`sources`**.
(`cards` and `card_events` are implemented; `recurring_defs` / `sources` are
still design-only.)

### `cards`

```js
{
  _id: ObjectId,
  number: 123,                 // monotonic, human-readable — drives branch name aikanban/card-123
  title: "string",
  description: "string",
  status: "todo" | "in_progress" | "need_review" | "done",
  priority: 0,                 // higher = sooner

  origin: { type: "manual" }
        | { type: "recurring", defId: ObjectId },

  // null until picked up by the scheduler
  session: { id: "string", url: "https://claude.ai/code/..." } | null,
  workspacePath: "workspaces/card-123" | null,

  // embedded — chosen at pickup, user-confirmed (see workspace flow)
  repos: [ { repo: "repo-a", branch: "aikanban/card-123", worktreePath: "workspaces/card-123/repo-a" } ],

  // dedupe key for recurring intake (e.g. notion page id); null for manual
  dedupeKey: "notion:page-abc" | null,

  // --- runtime fields, managed only by scheduler/runner (see scheduler-runner.md) ---
  runState: "idle" | "starting" | "running" | "waiting" | "exited" | "failed",
  process: { pid: 12345, startedAt: ISODate } | null,
  attempts: 0,                 // total start attempts (pickup + restarts)
  restarts: 0,                 // crash-driven fresh-session restarts
  nextStartAfter: ISODate | null,   // backoff gate for the reconciler
  lastError: { code: "string", message: "string", at: ISODate } | null,

  createdAt: ISODate,
  updatedAt: ISODate,
  pickedAt: ISODate | null,
  finishedAt: ISODate | null,
}
```

**Decisions**

- `repos` is **embedded**, not a separate collection: owned by the card, bounded (a handful), always loaded with the card. Classic embed case.
- `origin` is a **discriminated subdocument** instead of the brainstorm's `"recurring:<def_id>"` string — queryable (`origin.type`) and gives a real `defId` reference.
- `session` is a nested object (null pre-pickup) so the card-move and session-attach updates touch disjoint fields.
- `number` is a separate human-readable id (see [Human-readable IDs](#human-readable-ids)) — ObjectId is unwieldy in a git branch name.

### `card_events` (implemented)

Append-only audit log of card lifecycle actions — emitted from the `createTask`
and `updateTaskStatus` choke points. Feeds the (future) phone-review timeline and
debugging of the autonomous loop.

```js
{
  _id: ObjectId,
  cardId: ObjectId,                 // → cards._id (the audited card)
  from: "todo" | "in_progress" | "need_review" | "done" | null,  // null for a create
  to:   "todo" | "in_progress" | "need_review" | "done",         // target / attempted
  caller: "ui" | "agent" | "scheduler",
  at: ISODate,
  outcome: "success" | "failure",
  error: { code: "string", message: "string" } | null,  // non-null only on failure
}
```

**Decisions**

- **Separate collection, not embedded history** — keeps card-move updates touching
  disjoint fields and lets the log grow unbounded without rewriting the card.
- **`outcome` + `error` discriminator** — the bare `{from,to,caller,at}` shape can't
  tell a rejected move from a successful one. `outcome` makes failures
  distinguishable (it also disentangles a `failure` with `from=null` — a NotFound on
  a phantom card — from a `success` create with `from=null`); `error` carries the
  `ErrorCode` + message of a rejected transition for developer investigation. No
  free-text `reason`/`message` fields this slice.
- **Emits:** create (`success`, `from=null`, `to=todo`), each successful transition
  (`success`, `from`=before status), and each rejected transition (`failure`, with
  the error — both InvalidTransition and NotFound emit).
- **Read-back** (`listCardEvents`) is chronological, sorted `{ at: 1, _id: 1 }` so
  same-millisecond events keep a deterministic, insertion-ordered sequence.
- **Future UI:** grey out / filter `failure` events and surface `error` detail in the
  card-detail timeline (see [next-actions.md](./next-actions.md)).

### `recurring_defs`

```js
{
  _id: ObjectId,
  name: "Notion top-2",
  schedule: { cron: "0 * * * *" } | { intervalMs: 3600000 },
  sourceId: ObjectId,                       // ref → sources
  selectRule: { kind: "top_n_by_priority", n: 2 },
  enabled: true,
  createdAt: ISODate,
  updatedAt: ISODate,
}
```

### `sources`

Connection config for external task origins (Notion, repo sets, …).

```js
{
  _id: ObjectId,
  type: "notion" | "repo_set" | "...",
  name: "My Notion board",
  config: { /* shape depends on type: notion db/page id, filters, repo paths */ },
}
```

**Secrets:** do **not** store raw tokens here. Reference an env var / secret name (e.g. `config.tokenEnv: "NOTION_TOKEN"`) and resolve at runtime. (Open item — confirm secret handling for the solo/local setup.)

---

## Indexes

| Collection | Index | Why |
| ---------- | ----- | --- |
| `cards` | `{ status: 1, priority: -1, createdAt: 1 }` | board column reads + pickup ordering (priority, then FIFO) |
| `cards` | `{ number: 1 }` unique | lookups + branch naming |
| `cards` | `{ dedupeKey: 1 }` unique **partial** (`status ∈ {todo,in_progress,need_review}`) | Flow 1 dedupe: never two *open* cards for the same source item; closed (done) cards may repeat |
| `card_events` | `{ cardId: 1, at: 1 }` | chronological read-back of a card's audit timeline |
| `recurring_defs` | `{ enabled: 1 }` | scheduler scans enabled defs |

---

## Concurrency patterns (MongoDB-specific)

These replace the transactional guarantees a SQL design would lean on.

- **Atomic pickup / claim.** To respect the WIP limit with multiple scheduler ticks, claim a Todo card atomically:

  ```js
  cards.findOneAndUpdate(
    { status: "todo" },
    { $set: { status: "in_progress", pickedAt: now }, $currentDate: { updatedAt: true } },
    { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" }
  )
  ```

  Single-doc atomicity guarantees two ticks never grab the same card — no transaction required.

- **Card moves** (`update_task_status`, agent self-move, `set_session_url`, `add_repo_to_workspace` pushing into `repos`) are all single-document updates → inherently atomic.

- **Dedupe on intake** relies on the partial unique index above: `insertOne` (or upsert) and treat a duplicate-key error as "already queued."

---

## Human-readable IDs

MongoDB has no auto-increment. To get `card-123` style numbers for branches, use the **counters collection** pattern:

```js
// counters: { _id: "cards", seq: 123 }
const { seq } = await counters.findOneAndUpdate(
  { _id: "cards" }, { $inc: { seq: 1 } },
  { upsert: true, returnDocument: "after" }
);
// new card.number = seq
```

Atomic `$inc` gives gap-free-enough monotonic numbers. (Alternative: drop `number`, use a short slug of `_id` in branch names — simpler but less readable.)

---

## Data-access layer (decided)

**Native `mongodb` driver + Zod.** No ODM. Zod schemas are the single source of truth for each document shape: validate on write, infer TS types on read (`z.infer`). Keeps the access layer thin and explicit, no Mongoose magic.

**Parse-on-read (implemented).** Reads go through a thin wrapper layer in
[`src/db/find-z.ts`](../../src/db/find-z.ts) — `findOneZ` / `findManyZ` /
`findOneAndUpdateZ` — that `safeParse`s every returned document against a Zod
document schema (`cardDocumentSchema`, `cardEventDocumentSchema`). On schema drift
it logs the Zod issues and throws `AppError(ERR_SCHEMA_DRIFT)` rather than letting a
malformed doc flow downstream; an absent doc returns `null` unparsed. This caught
the `ignoreUndefined` class of bug (an omitted `description` persisting as BSON
`null`) at the boundary. `cards` reads (`getTask`/`listTasks`/`updateTaskStatus`
read-back) are migrated onto it; the `updateTaskStatus` miss-path pre-image read is
intentionally left raw so drift can't mask NotFound/InvalidTransition.

## Open questions

1. **Secret storage** for `sources.config` (env-ref vs encrypted-at-rest).
3. Whether `done` cards are pruned/archived or kept indefinitely (affects index sizes only marginally at solo scale).
