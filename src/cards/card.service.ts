import { type Filter, ObjectId } from "mongodb";
import { toClientCard } from "@/cards/card.mapper";
import {
  cardIdSchema,
  type CreateTaskInput,
  createTaskInputSchema,
  type ParsedCreateTaskInput,
} from "@/cards/card.schema";
import {
  type Card,
  type CardDocument,
  type OriginDocument,
  OriginType,
  RunState,
  Status,
} from "@/cards/card.type";
import { nextNumber } from "@/cards/counters";
import { AppError, ErrorCode } from "@/cards/errors";
import { Caller, legalFromStatuses } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";

/** Optional filter for {@link listTasks}. */
interface ListTasksFilter {
  status?: Status;
}

/** Options for {@link updateTaskStatus}. */
interface UpdateStatusOptions {
  caller?: Caller;
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
function toOriginDocument(origin: ParsedCreateTaskInput["origin"]): OriginDocument {
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
  const number = await nextNumber(db);
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

  const doc = await cardsCollection(db).findOne({ _id: new ObjectId(cardId) });
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

  const query: Filter<CardDocument> = {};
  if (filter.status) {
    query.status = filter.status;
  }

  const docs = await cardsCollection(db)
    .find(query)
    .sort({ priority: -1, createdAt: 1 })
    .toArray();

  return docs.map(toClientCard);
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
 * @param id - The card's hex id.
 * @param status - The target status.
 * @param options - Caller designation (defaults to the UI caller).
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

  // UI overrides any→any (bare `_id` filter); other callers are constrained to
  // their legal source statuses via `$in`, so an illegal move matches nothing.
  const filter =
    caller === Caller.Ui
      ? { _id }
      : { _id, status: { $in: legalFromStatuses(caller, status) } };

  const updated = await cardsCollection(db).findOneAndUpdate(
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
        },
      },
    ],
    { returnDocument: "after" },
  );

  if (!updated) {
    // The update matched nothing: disambiguate missing vs illegal transition.
    const existing = await cardsCollection(db).findOne({ _id });
    if (!existing) {
      throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
    }
    throw new AppError(
      ErrorCode.InvalidTransition,
      `caller "${caller}" may not move card ${id} from "${existing.status}" to "${status}"`,
    );
  }

  return toClientCard(updated);
}
