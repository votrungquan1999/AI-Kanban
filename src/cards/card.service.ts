import { type Filter, ObjectId } from "mongodb";
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
import { getDb } from "@/db/mongo";
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
}

/** True if the error is a MongoDB duplicate-key (E11000) error. */
function isDuplicateKeyError(error: unknown): boolean {
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
 * Creates a session-tracked card that starts directly in the in_progress lane
 * (an active session is already working it, so it skips Todo). Mirrors the
 * runtime fields {@link claimCard} sets on pick-up — `runState: Running`,
 * `pickedAt: now` — and stores the session's `tags`/`sessionId` verbatim with an
 * empty progress history. Emits a single `null -> in_progress` create event.
 * @param input - Caller input; validated against {@link createCardInputSchema}.
 * @returns The created card mapped to the client-facing shape.
 */
export async function createCard(input: CreateCardInput): Promise<Card> {
  const parsed = createCardInputSchema.parse(input);
  const db = await getDb();
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
    dedupeKey: null,
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

  await cardsCollection(db).insertOne(doc, { ignoreUndefined: true });

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

/**
 * Surveys the board as a compact per-card summary (id, number, title, status,
 * nextAction, description truncated to 200 code points) via
 * {@link findManyProjectedZ}. Runs the same status reconcile as the web
 * board-read path (expired Blocked -> NeedReview, idle in_progress -> Staled
 * — see {@link reconcileBlockedCards}/{@link reconcileStaledCards}) before
 * querying, so an agent survey matches what a human sees on the board (D6).
 * @param filter - Optional status/tags/text filters and result limit.
 * @returns Lean cards mapped to the client-facing shape.
 */
export async function listCards(
  filter: ListCardsFilter = {},
): Promise<LeanCard[]> {
  await reconcileBlockedCards();
  await reconcileStaledCards();

  const db = await getDb();

  // Explicit non-empty status filter (ANY-of) overrides the default exclusion
  // — operator named exactly what they want, including Done/Archived. Empty
  // array falls through to the default (D9).
  const query: Filter<CardDocument> =
    filter.status && filter.status.length > 0
      ? { status: { $in: filter.status } }
      : { status: { $nin: [Status.Archived, Status.Done] } };

  // ANY-of tags filter; empty array is never emitted as `{$in: []}` (matches
  // nothing) — instead it's just not applied (D9).
  if (filter.tags && filter.tags.length > 0) {
    query.tags = { $in: filter.tags };
  }

  // Keyword search over title+description (D3, needs the text index from
  // bootstrapIndexes); blank/whitespace text is not applied (D9). No
  // `$meta: "textScore"` sort — the `updatedAt` sort below stays the sole
  // ordering.
  if (filter.text && filter.text.trim().length > 0) {
    query.$text = { $search: filter.text };
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

  // `updatedAt` is deliberately not in the lean projection above — Mongo
  // sorts before projecting, so sorting on a non-projected field is fine.
  const docs = await findManyProjectedZ(
    cardsCollection(db),
    query,
    projection,
    leanCardDocumentSchema,
    { sort: { updatedAt: -1 }, limit },
  );

  return docs.map(toLeanCard);
}

/**
 * Moves a card to `status` in one atomic update, enforcing the transition
 * policy per caller. The human UI may move a card any→any (the override); the
 * agent may move only along its legal lifecycle edges — enforced atomically by
 * filtering the update on the legal source statuses, so an illegal move simply
 * matches nothing. `pickedAt` is set on the first transition into `in_progress`
 * (only when still null), `finishedAt` on a move into `done`, and `updatedAt`
 * always bumps. When the update matches nothing, a single follow-up read
 * disambiguates: a missing card throws {@link ErrorCode.NotFound}, an existing
 * card on an illegal source status throws {@link ErrorCode.InvalidTransition}.
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

  // UI overrides any→any (bare `_id` filter); other callers are constrained to
  // their legal source statuses via `$in`, so an illegal move matches nothing.
  const filter =
    caller === Caller.Ui
      ? { _id }
      : { _id, status: { $in: legalFromStatuses(caller, status) } };

  const updated = await findOneAndUpdateZ(
    cardsCollection(db),
    filter,
    [
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
    ],
    cardDocumentSchema,
    { returnDocument: "after" },
  );

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
