import { type Db, type Filter, ObjectId } from "mongodb";
import { reconcileBlockedCards } from "@/cards/card.blocked.service";
import {
  cardDocumentSchema,
  leanCardDocumentSchema,
} from "@/cards/card.document.schema";
import { toClientCard, toLeanCard } from "@/cards/card.mapper";
import {
  type CreateCardInput,
  type CreateTaskInput,
  cardIdSchema,
  createCardInputSchema,
  createTaskInputSchema,
  type ParsedCreateCardInput,
  type ParsedCreateTaskInput,
} from "@/cards/card.schema";
import { reconcileStaledCards } from "@/cards/card.staled.service";
import {
  type Card,
  type CardDocument,
  type LeanCard,
  type OriginDocument,
  OriginType,
  RunState,
  Status,
} from "@/cards/card.type";
import { emitCardEvent } from "@/cards/card-event.service";
import { EventOutcome } from "@/cards/card-event.type";
import { nextNumber } from "@/cards/counters";
import { AppError, ErrorCode } from "@/cards/errors";
import { Caller, legalFromStatuses } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import {
  findManyProjectedZ,
  findManyZ,
  findOneAndUpdateZ,
  findOneZ,
} from "@/db/find-z";
import { OPEN_STATUSES } from "@/db/indexes";
import { getDb, getIndexBootstrapErrors, withTransaction } from "@/db/mongo";
import { getDefaultBlockInterval } from "@/settings/settings.service";

/** Optional filter for {@link listTasks}. */
interface ListTasksFilter {
  status?: Status;
}

/** Optional filter for {@link listCards}. */
interface ListCardsFilter {
  /** ANY-of status filter; when given, replaces the default hide-done/archived. */
  status?: Status[];
  /** ANY-of tags filter; an empty/omitted array applies no filter (D9). */
  tags?: string[];
  /** Max cards returned; defaults to ~50, hard-capped at 200 (D11). */
  limit?: number;
  /** Keyword search over title+description; empty/whitespace applies no filter (D9). */
  text?: string;
}

/** {@link listCards} default page size when `limit` is omitted (D11). */
const DEFAULT_LIST_CARDS_LIMIT = 50;
/** {@link listCards} hard cap — a requested `limit` above this is clamped (D11). */
const MAX_LIST_CARDS_LIMIT = 200;

/** Options for {@link updateTaskStatus}. */
interface UpdateStatusOptions {
  caller?: Caller;
  /**
   * The block countdown duration (ms) to apply when moving INTO Blocked. When
   * omitted, the card's own stored interval is replayed, falling back to the
   * board default (see {@link updateTaskStatus}).
   */
  intervalMs?: number;
  /**
   * When a move collides on `dedupeKey` (reviving a stale card into a slot its
   * session's open card already holds), displace the current open holder
   * instead of throwing {@link ErrorCode.Duplicate} (D13).
   */
  force?: boolean;
}

/** True if the error is a MongoDB duplicate-key (E11000) error. */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/** Converts parsed client origin (hex ids) into a stored origin (ObjectId). */
function toOriginDocument(
  origin: ParsedCreateTaskInput["origin"],
): OriginDocument {
  if (origin.type === OriginType.Recurring) {
    return { type: OriginType.Recurring, defId: new ObjectId(origin.defId) };
  }

  return { type: OriginType.Manual };
}

/**
 * Creates a new card in the `todo` column with an assigned monotonic number
 * and default runtime fields. A duplicate open `dedupeKey` throws
 * {@link ErrorCode.Duplicate}.
 * @param input - Caller input; validated against the shared schema.
 * @returns The created card mapped to the client-facing shape.
 */
export async function createTask(input: CreateTaskInput): Promise<Card> {
  const parsed = createTaskInputSchema.parse(input);
  const db = await getDb();
  const number = await nextNumber(db, "cards");
  const now = new Date();

  const doc: CardDocument = {
    _id: new ObjectId(),
    number,
    title: parsed.title,
    description: parsed.description,
    status: Status.Todo,
    priority: parsed.priority,
    origin: toOriginDocument(parsed.origin),
    dedupeKey: parsed.dedupeKey ?? null,
    runState: RunState.Idle,
    process: null,
    attempts: 0,
    restarts: 0,
    nextStartAfter: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    pickedAt: null,
    finishedAt: null,
    blockedUntil: null,
    blockInterval: null,
    workspacePath: null,
    repos: [],
  };

  try {
    // ignoreUndefined so an omitted `description` is absent (not stored as
    // BSON null), keeping create/read consistent and `Card.description?` sound.
    await cardsCollection(db).insertOne(doc, { ignoreUndefined: true });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(
        ErrorCode.Duplicate,
        "a card with this dedupeKey is already open",
      );
    }
    throw error;
  }

  await emitCardEvent(db, {
    cardId: doc._id,
    from: null,
    to: Status.Todo,
    caller: Caller.Ui,
    outcome: EventOutcome.Success,
    error: null,
  });

  return toClientCard(doc);
}

/**
 * The dedupeKey a session's card carries, so a single session can never open
 * two cards for the same work. The first (base) card is keyed
 * `session:<id>`; an explicit divergence into a distinct task gets a
 * `:<version>` suffix (`session:<id>:2`, `:3`, …). The partial-unique index on
 * `dedupeKey` (open cards only) is what actually enforces it.
 * @param sessionId - The session's handle.
 * @param version - 1 for the base card, >1 for a diverged card.
 * @returns The dedupeKey string.
 */
export function sessionDedupeKey(sessionId: string, version: number): string {
  return version <= 1
    ? `session:${sessionId}`
    : `session:${sessionId}:${version}`;
}

/**
 * The statuses a session's card can be adopted from — anything short of
 * terminal. A card in flight (`in_progress`) or merely parked (`need_review`
 * awaiting review, `staled` idled out, `blocked` waiting on a dependency) is
 * still the session's work, so a re-invoked {@link createCard} reclaims it
 * rather than duplicating. `done`/`archived` are terminal (never adopted); a
 * session card never sits in `todo`.
 */
const ADOPTABLE_SESSION_STATUSES = [
  Status.InProgress,
  Status.NeedReview,
  Status.Staled,
  Status.Blocked,
];

/**
 * The card a session still owns — its most recent non-terminal card, if any.
 * A non-divergent {@link createCard} adopts this instead of opening a
 * duplicate, which is what lets tracking survive a memory-wiping compact.
 * @param db - The database handle.
 * @param sessionId - The session's handle.
 * @returns The adoptable card document, or `null` if the session has none.
 */
async function findActiveSessionCard(
  db: Db,
  sessionId: string,
): Promise<CardDocument | null> {
  const [doc] = await findManyZ(
    cardsCollection(db),
    { sessionId, status: { $in: ADOPTABLE_SESSION_STATUSES } },
    cardDocumentSchema,
    // Sort by the monotonic unique `number`, not createdAt: two rapid creates
    // can share a millisecond, and "the newest card" must be deterministic.
    { sort: { number: -1 }, limit: 1 },
  );
  return doc ?? null;
}

/**
 * Adopt a session's existing card: return it as-is when already `in_progress`,
 * otherwise resume it (a parked `need_review`/`staled`/`blocked` card the
 * session is reclaiming) back to `in_progress` so the board reflects active
 * work. The resume is an audited agent transition — the legal edges into
 * `in_progress` exist for all three parked statuses.
 * @param active - The adoptable card document found for the session.
 * @returns The adopted card in client shape, always `in_progress`.
 */
async function adoptSessionCard(active: CardDocument): Promise<Card> {
  if (active.status === Status.InProgress) return toClientCard(active);
  return updateTaskStatus(active._id.toHexString(), Status.InProgress, {
    caller: Caller.Agent,
  });
}

/** Backstop on the version-climb loop; far above any real session's card count. */
const MAX_SESSION_CARD_VERSIONS = 50;

/**
 * Inserts a fresh session card, climbing the dedupeKey version until it lands
 * on a free one. On a duplicate-key collision a non-divergent call re-checks
 * for a live card and adopts it (resolves the concurrent-create race in favor
 * of one card); a divergent call climbs to the next version.
 * @param db - The database handle.
 * @param parsed - The validated session-card input.
 * @returns The created (or adopted) card in client shape.
 */
async function insertSessionCard(
  db: Db,
  parsed: ParsedCreateCardInput,
): Promise<Card> {
  for (let version = 1; version <= MAX_SESSION_CARD_VERSIONS; version++) {
    const number = await nextNumber(db, "cards");
    const now = new Date();
    const doc: CardDocument = {
      _id: new ObjectId(),
      number,
      title: parsed.title,
      description: parsed.description,
      // Starts in_progress / running: a live session is already working it, so it
      // never sits in the Todo queue. attempts stays 0 — it was never queue-claimed.
      status: Status.InProgress,
      priority: 0,
      origin: { type: OriginType.Manual },
      // Session cards dedupe on the session handle; session-less callers can't.
      dedupeKey: parsed.sessionId
        ? sessionDedupeKey(parsed.sessionId, version)
        : null,
      runState: RunState.Running,
      process: null,
      attempts: 0,
      restarts: 0,
      nextStartAfter: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      pickedAt: now,
      finishedAt: null,
      blockedUntil: null,
      blockInterval: null,
      workspacePath: null,
      repos: [],
      tags: parsed.tags,
      sessionId: parsed.sessionId,
      nextAction: parsed.nextAction,
      progress: [],
      decisions: [],
    };

    try {
      await cardsCollection(db).insertOne(doc, { ignoreUndefined: true });
    } catch (error) {
      // This version is held by another open card for the session.
      if (parsed.sessionId && isDuplicateKeyError(error)) {
        if (!parsed.forceNew) {
          const active = await findActiveSessionCard(db, parsed.sessionId);
          if (active) return adoptSessionCard(active);
        }
        continue; // climb to the next free version
      }
      throw error;
    }

    // Single create event: the card was never in Todo, so `from` is null.
    await emitCardEvent(db, {
      cardId: doc._id,
      from: null,
      to: Status.InProgress,
      caller: Caller.Agent,
      outcome: EventOutcome.Success,
      error: null,
    });

    return toClientCard(doc);
  }

  throw new AppError(
    ErrorCode.Duplicate,
    `could not allocate a session card version for ${parsed.sessionId}`,
  );
}

/**
 * Inserts a session-less standalone card at a non-in_progress status (D12/D14):
 * filing a card the caller isn't actively tracking, so it never carries a
 * `sessionId` or `dedupeKey` and can't be adopted by a session's later
 * create. Initialized idle (never picked up) by default; `done`/`blocked`
 * placements additionally apply the same side effects `updateTaskStatus`
 * applies on a move into that status (finishedAt / block countdown).
 * @param db - The database handle.
 * @param parsed - The validated create input.
 * @param status - The non-in_progress status to file the card at.
 * @returns The created card mapped to the client-facing shape.
 */
async function insertStandaloneCard(
  db: Db,
  parsed: ParsedCreateCardInput,
  status: Status,
): Promise<Card> {
  const number = await nextNumber(db, "cards");
  const now = new Date();
  // Mirrors updateTaskStatus's to-Done side effect: a card filed already-done is
  // stamped finished immediately, not left null awaiting a move.
  const isDone = status === Status.Done;
  // Mirrors updateTaskStatus's to-Blocked side effect: no create-time interval
  // param exists, so a filed-blocked card always starts the board default's
  // countdown (never the card's own — there's no prior stored one).
  const isBlocked = status === Status.Blocked;
  const blockInterval = isBlocked ? await getDefaultBlockInterval() : null;
  // Non-null exactly when isBlocked, so this drives blockedUntil without a cast.
  const blockedUntil =
    blockInterval !== null ? new Date(now.getTime() + blockInterval) : null;

  const doc: CardDocument = {
    _id: new ObjectId(),
    number,
    title: parsed.title,
    description: parsed.description,
    status,
    priority: 0,
    origin: { type: OriginType.Manual },
    // Session-less: always null, so this card is never adopted by a session's
    // active-card lookup and never collides with the open-status dedupe index.
    dedupeKey: null,
    runState: RunState.Idle,
    process: null,
    attempts: 0,
    restarts: 0,
    nextStartAfter: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    pickedAt: null,
    finishedAt: isDone ? now : null,
    blockedUntil,
    blockInterval,
    workspacePath: null,
    repos: [],
    tags: parsed.tags,
    nextAction: parsed.nextAction,
    progress: [],
    decisions: [],
  };

  // ignoreUndefined so an omitted description/nextAction is absent, not BSON
  // null — matches createTask/insertSessionCard (SchemaDrift otherwise).
  await cardsCollection(db).insertOne(doc, { ignoreUndefined: true });

  await emitCardEvent(db, {
    cardId: doc._id,
    from: null,
    to: status,
    caller: Caller.Agent,
    outcome: EventOutcome.Success,
    error: null,
  });

  return toClientCard(doc);
}

/**
 * Creates a session-tracked card that starts directly in the in_progress lane
 * (an active session is already working it, so it skips Todo). Idempotent per
 * session: a non-divergent call for a session that already has a non-terminal
 * card ({@link ADOPTABLE_SESSION_STATUSES}) adopts that card — resuming a parked
 * one to in_progress — rather than opening a duplicate, so repeated calls (e.g.
 * after a context compact) never fan out into many cards. An explicit
 * divergence (`forceNew`) opens a fresh, versioned card. Session-less callers
 * get today's plain create (no dedup possible without a handle).
 *
 * A `status` other than `in_progress` (D12/D14) skips all of the above: it
 * files a session-less standalone card via {@link insertStandaloneCard}
 * instead, before the adopt check even runs — so it can never touch or
 * duplicate the calling session's live card.
 * @param input - Caller input; validated against {@link createCardInputSchema}.
 * @returns The created (or adopted) card mapped to the client-facing shape.
 */
export async function createCard(input: CreateCardInput): Promise<Card> {
  const result = createCardInputSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      ErrorCode.Validation,
      `invalid card create: ${result.error.message}`,
    );
  }
  const parsed = result.data;
  const db = await getDb();

  if (parsed.status !== Status.InProgress) {
    return insertStandaloneCard(db, parsed, parsed.status);
  }

  if (parsed.sessionId && !parsed.forceNew) {
    const active = await findActiveSessionCard(db, parsed.sessionId);
    if (active) return adoptSessionCard(active);
  }

  return insertSessionCard(db, parsed);
}

/**
 * Reads a single card by its hex id and returns it in the client-facing shape.
 * An unknown id throws {@link ErrorCode.NotFound}.
 * @param id - The card's hex id (validated against the shared schema).
 * @returns The card mapped to the client-facing shape.
 */
export async function getTask(id: string): Promise<Card> {
  const cardId = cardIdSchema.parse(id);
  const db = await getDb();

  const doc = await findOneZ(
    cardsCollection(db),
    { _id: new ObjectId(cardId) },
    cardDocumentSchema,
  );
  if (!doc) {
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  return toClientCard(doc);
}

/**
 * Lists cards as client-facing objects, sorted by priority (desc) then
 * creation time (asc). Optionally filters to a single status/column.
 * @param filter - Optional status filter.
 * @returns Cards mapped to the client-facing shape.
 */
export async function listTasks(filter: ListTasksFilter = {}): Promise<Card[]> {
  const db = await getDb();

  // An explicit status filter is honored as-is; the default board view hides
  // archived (soft-deleted) cards.
  const query: Filter<CardDocument> = {};
  if (filter.status) {
    query.status = filter.status;
  } else {
    query.status = { $ne: Status.Archived };
  }

  const docs = await findManyZ(cardsCollection(db), query, cardDocumentSchema, {
    sort: { priority: -1, createdAt: 1 },
  });

  return docs.map(toClientCard);
}

/** Mongo's `IndexNotFound`, raised by a `$text` query with no text index. */
const INDEX_NOT_FOUND_CODE = 27;

/**
 * Recognises the driver error a `$text` query raises when the text index is
 * absent — matched on the numeric server code, not the message text.
 * @param error - The value thrown by the find.
 * @returns True when the failure was a missing text index.
 */
function isMissingTextIndex(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === INDEX_NOT_FOUND_CODE
  );
}

/**
 * What the last index bootstrap recorded, as a suffix for the search-unavailable
 * error — usually the reason the text index is missing (a failed build logs here
 * and nowhere the caller can reach). Empty when bootstrap left nothing behind,
 * which includes the case where it never ran in this process.
 * @returns A leading-separator detail string, or `""`.
 */
function bootstrapDetail(): string {
  const errors = getIndexBootstrapErrors();
  if (errors.length === 0) return "";
  return `. Index bootstrap reported: ${errors.map((error) => error.message).join("; ")}`;
}

/**
 * Surveys the board as a compact per-card summary (id, number, title, status,
 * nextAction, description truncated to 200 code points) via
 * {@link findManyProjectedZ}. Runs the same status reconcile as the web
 * board-read path (expired Blocked -> NeedReview, idle in_progress -> Staled
 * — see {@link reconcileBlockedCards}/{@link reconcileStaledCards}) before
 * querying, so an agent survey matches what a human sees on the board (D6).
 * A `text` search spans every status unless `status` was given (D10).
 * @param filter - Optional status/tags/text filters and result limit.
 * @returns Lean cards mapped to the client-facing shape.
 * @throws {AppError} {@link ErrorCode.SearchUnavailable} when `text` was given
 * but the text index is missing; an unfiltered listing still works.
 */
export async function listCards(
  filter: ListCardsFilter = {},
): Promise<LeanCard[]> {
  await reconcileBlockedCards();
  await reconcileStaledCards();

  const db = await getDb();

  // Keyword search over title+description (needs the text index from
  // bootstrapIndexes); blank/whitespace text is not applied (D9). `hasText`
  // also picks the status scope and the sort below.
  const text = filter.text?.trim();
  const hasText = Boolean(text);

  // Status scope, in precedence order (D9):
  // 1. an explicit non-empty filter wins — the caller named what they want
  // 2. a keyword search spans every status: the finished card is exactly what
  //    a caller searching for prior work needs to find (D10)
  // 3. otherwise the board default hides done/archived
  const query: Filter<CardDocument> =
    filter.status && filter.status.length > 0
      ? { status: { $in: filter.status } }
      : hasText
        ? {}
        : { status: { $nin: [Status.Archived, Status.Done] } };

  // ANY-of tags filter; empty array is never emitted as `{$in: []}` (matches
  // nothing) — instead it's just not applied (D9).
  if (filter.tags && filter.tags.length > 0) {
    query.tags = { $in: filter.tags };
  }

  if (text) {
    query.$text = { $search: text };
  }

  // Paired with `leanCardDocumentSchema` (card.document.schema.ts) — no
  // compile-time link; keep both edited together, a mismatch throws
  // SchemaDrift at read time.
  const projection = {
    _id: 1,
    number: 1,
    title: 1,
    status: 1,
    nextAction: 1,
    description: 1,
  };

  // Clamp into [1, 200] (D11): the MCP schema rejects <=0, but an internal
  // caller bypassing it could pass 0 — and Mongo `.limit(0)` means unbounded.
  const limit = Math.min(
    Math.max(filter.limit ?? DEFAULT_LIST_CARDS_LIMIT, 1),
    MAX_LIST_CARDS_LIMIT,
  );

  // Neither `updatedAt` nor `score` is in the lean projection above — Mongo
  // sorts/scores before projecting, so a non-projected sort field is fine.
  // A text query ranks by relevance (best match first); otherwise newest
  // first.
  try {
    const docs = await findManyProjectedZ(
      cardsCollection(db),
      query,
      projection,
      leanCardDocumentSchema,
      {
        sort: hasText
          ? { score: { $meta: "textScore" }, updatedAt: -1 }
          : { updatedAt: -1 },
        limit,
      },
    );

    return docs.map(toLeanCard);
  } catch (error) {
    // A $text query with no text index is the one failure a caller can act on
    // — an unsearched listing still works, so name it rather than letting an
    // opaque driver error escape as if the board were empty.
    if (isMissingTextIndex(error)) {
      throw new AppError(
        ErrorCode.SearchUnavailable,
        `keyword search is unavailable — the board's search index is not built; retry without \`text\`${bootstrapDetail()}`,
      );
    }
    throw error;
  }
}

/**
 * Moves a card to `status` in one atomic update, enforcing the transition
 * policy per caller. Human UI and Agent may move a card any→any (full parity);
 * other callers (Scheduler/System) may move only along their legal lifecycle
 * edges — enforced atomically by filtering the update on the legal source
 * statuses, so an illegal move simply matches nothing.
 * `pickedAt` is set on the first transition into `in_progress`
 * (only when still null), `finishedAt` on a move into `done`, and `updatedAt`
 * always bumps. When the update matches nothing, a single follow-up read
 * disambiguates: a missing card throws {@link ErrorCode.NotFound}, an existing
 * card on an illegal source status throws {@link ErrorCode.InvalidTransition}. A
 * move that collides with an open card sharing its `dedupeKey` throws
 * {@link ErrorCode.Duplicate}; `options.force` displaces that holder (clears its
 * `dedupeKey`) and retries the move in a single transaction, so a retry failure
 * rolls the displacement back rather than orphaning the holder.
 * `blockedUntil` is driven off the same atomic update: entering Blocked starts
 * a server-clock countdown of `options.intervalMs`; re-entering it ("Reset
 * timer") with no interval replays the card's own stored `blockInterval`,
 * falling back to the board default for a legacy card that never recorded one.
 * The resolved interval is also stored back on `blockInterval`. Leaving Blocked
 * clears `blockedUntil`; any other move preserves both fields.
 * @param id - The card's hex id.
 * @param status - The target status.
 * @param options - Caller designation (defaults to the UI caller) and the
 *   optional block interval (ms) applied when moving into Blocked.
 * @returns The updated card mapped to the client-facing shape.
 */
export async function updateTaskStatus(
  id: string,
  status: Status,
  options: UpdateStatusOptions = {},
): Promise<Card> {
  const caller = options.caller ?? Caller.Ui;
  const db = await getDb();
  const _id = new ObjectId(id);
  const isToInProgress = status === Status.InProgress;
  const isToDone = status === Status.Done;
  const isToBlocked = status === Status.Blocked;

  // Read the pre-image once: it provides the `from` status for the audit event
  // and disambiguates a miss (missing card vs illegal transition). Raw read (not
  // findOneZ) so a drifted doc here cannot mask NotFound/InvalidTransition.
  const preImage = await cardsCollection(db).findOne({ _id });
  const isFromBlocked = preImage?.status === Status.Blocked;

  // The countdown applied when entering Blocked: the explicit interval if one
  // was supplied; otherwise "Reset timer" replays the card's own stored
  // interval, falling back to the board default for a legacy card that never
  // recorded one. Resolved only on a to-Blocked transition. The pre-image read
  // above already provides the stored interval — no extra round-trip.
  let resolvedInterval: number | undefined;
  if (isToBlocked) {
    resolvedInterval =
      options.intervalMs ??
      preImage?.blockInterval ??
      (await getDefaultBlockInterval());
  }

  // UI overrides any→any (bare `_id` filter); other callers go through the
  // `$in` legal-source-statuses filter — but the Agent's source set is now
  // every status (D1's any→any policy), so in practice this is any→any too.
  // Scheduler/System still have empty from-sets, so `$in` still guards them.
  const filter =
    caller === Caller.Ui
      ? { _id }
      : { _id, status: { $in: legalFromStatuses(caller, status) } };

  const updatePipeline = [
    {
      $set: {
        status,
        updatedAt: "$$NOW",
        pickedAt: isToInProgress
          ? { $ifNull: ["$pickedAt", "$$NOW"] }
          : "$pickedAt",
        finishedAt: isToDone ? "$$NOW" : "$finishedAt",
        // Into Blocked → start a server-clock countdown of `resolvedInterval`
        // (also resets it on "Reset timer", which re-enters Blocked). Out of
        // Blocked → clear it. Otherwise preserve the existing value. isToBlocked
        // is checked first so a Blocked→Blocked reset wins over the clear branch.
        blockedUntil: isToBlocked
          ? { $add: ["$$NOW", resolvedInterval] }
          : isFromBlocked
            ? null
            : "$blockedUntil",
        // Remember the interval the card was blocked with (replayed by "Reset
        // timer"); preserved untouched on every non-Blocked transition.
        blockInterval: isToBlocked ? resolvedInterval : "$blockInterval",
      },
    },
  ];

  let updated: CardDocument | null;
  try {
    updated = await findOneAndUpdateZ(
      cardsCollection(db),
      filter,
      updatePipeline,
      cardDocumentSchema,
      { returnDocument: "after" },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    // One literal for both the rejected-collision and forced-retry-still-collides
    // paths, so the two can't drift apart.
    const duplicateMessage = `card ${id} can't move to "${status}" — another open card already holds its dedupeKey`;

    if (!options.force) {
      const duplicateError = new AppError(
        ErrorCode.Duplicate,
        duplicateMessage,
      );
      // D16/D19: audit the rejected attempt itself, mirroring the
      // InvalidTransition failure branch below.
      await emitCardEvent(db, {
        cardId: _id,
        from: preImage?.status ?? null,
        to: status,
        caller,
        outcome: EventOutcome.Failure,
        error: { code: duplicateError.code, message: duplicateError.message },
      });
      throw duplicateError;
    }

    // The E11000 proves the moving card's dedupeKey is a real string colliding
    // with the open holder — require it explicitly so the displacement filter
    // can never match an arbitrary `dedupeKey: null` card.
    const holderKey = preImage?.dedupeKey;
    if (typeof holderKey !== "string") {
      throw new AppError(ErrorCode.Duplicate, duplicateMessage);
    }

    // force: displace the CURRENT open holder of this dedupeKey (not this card —
    // it's mid-move) then retry the move, both in ONE transaction so a retry
    // failure rolls the displacement back rather than stranding the holder with
    // its dedupeKey cleared and no move applied. A second E11000 means the
    // collision wasn't the one-holder case this override targets; surface it as
    // a duplicate rather than looping.
    updated = await withTransaction(async (session) => {
      const displacedHolder = await cardsCollection(db).findOneAndUpdate(
        {
          dedupeKey: holderKey,
          status: { $in: OPEN_STATUSES },
          _id: { $ne: _id },
        },
        { $set: { dedupeKey: null } },
        { session },
      );

      // D16/D19: audit the displacement on the holder itself — a same-status
      // event (its status doesn't change) recording that its dedupeKey was
      // cleared to make room for this move. Attributed to the caller that
      // forced the move, so the log answers who displaced it.
      if (displacedHolder) {
        await emitCardEvent(
          db,
          {
            cardId: displacedHolder._id,
            from: displacedHolder.status,
            to: displacedHolder.status,
            caller,
            outcome: EventOutcome.Success,
            error: null,
          },
          { session },
        );
      }

      try {
        return await findOneAndUpdateZ(
          cardsCollection(db),
          filter,
          updatePipeline,
          cardDocumentSchema,
          { returnDocument: "after", session },
        );
      } catch (retryError) {
        if (isDuplicateKeyError(retryError)) {
          throw new AppError(ErrorCode.Duplicate, duplicateMessage);
        }
        throw retryError;
      }
    });
  }

  if (!updated) {
    // The update matched nothing: disambiguate missing vs illegal transition
    // using the pre-image already read above, record a failure event (with the
    // error detail for developer investigation), then throw.
    const error = preImage
      ? new AppError(
          ErrorCode.InvalidTransition,
          `caller "${caller}" may not move card ${id} from "${preImage.status}" to "${status}"`,
        )
      : new AppError(ErrorCode.NotFound, `card ${id} not found`);

    await emitCardEvent(db, {
      cardId: _id,
      from: preImage?.status ?? null,
      to: status,
      caller,
      outcome: EventOutcome.Failure,
      error: { code: error.code, message: error.message },
    });

    throw error;
  }

  await emitCardEvent(db, {
    cardId: _id,
    from: preImage?.status ?? null,
    to: status,
    caller,
    outcome: EventOutcome.Success,
    error: null,
  });

  return toClientCard(updated);
}
