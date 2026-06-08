import { ObjectId } from "mongodb";
import { nextNumber } from "@/cards/counters";
import { AppError, ErrorCode } from "@/cards/errors";
import { recurringTasksCollection } from "@/db/collections";
import { findManyZ, findOneZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";
import { recurringTaskDocumentSchema } from "@/recurring/recurring.document.schema";
import { toClientRecurringTask } from "@/recurring/recurring.mapper";
import {
  type CreateRecurringInput,
  createRecurringInputSchema,
  recurringIdSchema,
} from "@/recurring/recurring.schema";
import {
  RecurringRunState,
  type RecurringTask,
  type RecurringTaskDocument,
} from "@/recurring/recurring.type";

/**
 * Creates a recurring task with an assigned monotonic number and default
 * runtime state. The task is `idle`, `enabled`, and immediately due
 * (`nextDueAt = createdAt`), so the next routine wake picks it up.
 * @param input - Caller input; validated against the shared schema.
 * @returns The created recurring task mapped to the client-facing shape.
 */
export async function createRecurringTask(
  input: CreateRecurringInput,
): Promise<RecurringTask> {
  const parsed = createRecurringInputSchema.parse(input);
  const db = await getDb();
  const number = await nextNumber(db, "recurring_tasks");
  const now = new Date();

  const doc: RecurringTaskDocument = {
    _id: new ObjectId(),
    number,
    title: parsed.title,
    instruction: parsed.instruction,
    everyHours: parsed.everyHours,
    enabled: true,
    runState: RecurringRunState.Idle,
    nextDueAt: now,
    lastRunAt: null,
    lastOutcome: null,
    createdAt: now,
    updatedAt: now,
  };

  await recurringTasksCollection(db).insertOne(doc, { ignoreUndefined: true });

  return toClientRecurringTask(doc);
}

/**
 * Lists the recurring tasks that are due for the routine to execute now: those
 * that are `enabled`, `idle`, and whose `nextDueAt` has been reached. Disabled,
 * running, failed, and not-yet-due tasks are excluded. Sorted oldest-due first.
 * @returns The due recurring tasks mapped to the client-facing shape.
 */
export async function listRecurringDue(): Promise<RecurringTask[]> {
  const db = await getDb();
  const now = new Date();

  const docs = await findManyZ(
    recurringTasksCollection(db),
    {
      enabled: true,
      runState: RecurringRunState.Idle,
      nextDueAt: { $lte: now },
    },
    recurringTaskDocumentSchema,
    { sort: { nextDueAt: 1 } },
  );

  return docs.map(toClientRecurringTask);
}

/**
 * Lists all recurring tasks for the operator surface (every state — disabled,
 * running, failed, and not-yet-due included), sorted by number ascending.
 * @returns All recurring tasks mapped to the client-facing shape.
 */
export async function listRecurringTasks(): Promise<RecurringTask[]> {
  const db = await getDb();

  const docs = await findManyZ(
    recurringTasksCollection(db),
    {},
    recurringTaskDocumentSchema,
    { sort: { number: 1 } },
  );

  return docs.map(toClientRecurringTask);
}

/**
 * Reads a single recurring task by its hex id and returns it in the
 * client-facing shape. An unknown id throws {@link ErrorCode.NotFound}.
 * @param id - The task's hex id (validated against the shared schema).
 * @returns The recurring task mapped to the client-facing shape.
 */
export async function getRecurringTask(id: string): Promise<RecurringTask> {
  const recurringId = recurringIdSchema.parse(id);
  const db = await getDb();

  const doc = await findOneZ(
    recurringTasksCollection(db),
    { _id: new ObjectId(recurringId) },
    recurringTaskDocumentSchema,
  );
  if (!doc) {
    throw new AppError(ErrorCode.NotFound, `recurring task ${id} not found`);
  }

  return toClientRecurringTask(doc);
}
