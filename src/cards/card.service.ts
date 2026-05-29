import { type Filter, ObjectId } from "mongodb";
import { toClientCard } from "@/cards/card.mapper";
import {
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
import { Caller, canTransition } from "@/cards/transition-policy";
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
    await cardsCollection(db).insertOne(doc);
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
 * Moves a card to `status` in one atomic update. The human UI caller may move
 * a card any→any; `pickedAt` is set on the first transition into
 * `in_progress` (only when still null), `finishedAt` on a move into `done`,
 * and `updatedAt` always bumps. Unknown id throws {@link ErrorCode.NotFound};
 * a disallowed caller throws {@link ErrorCode.InvalidTransition}.
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
  if (!canTransition(caller)) {
    throw new AppError(
      ErrorCode.InvalidTransition,
      `caller "${caller}" may not change card status`,
    );
  }

  const db = await getDb();
  const isToInProgress = status === Status.InProgress;
  const isToDone = status === Status.Done;

  const updated = await cardsCollection(db).findOneAndUpdate(
    { _id: new ObjectId(id) },
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
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  return toClientCard(updated);
}
