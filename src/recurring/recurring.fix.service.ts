import { ObjectId } from "mongodb";
import { AppError, ErrorCode } from "@/cards/errors";
import { recurringTasksCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";
import { recurringTaskDocumentSchema } from "@/recurring/recurring.document.schema";
import { toClientRecurringTask } from "@/recurring/recurring.mapper";
import {
  type FixNoteInput,
  fixNoteInputSchema,
  recurringIdSchema,
} from "@/recurring/recurring.schema";
import {
  RecurringRunState,
  type RecurringTask,
} from "@/recurring/recurring.type";

/**
 * Records an operator fix note on a failed task (the editable comment explaining
 * how to fix it). Only a `failed` task accepts a fix note; a task in another
 * state is disambiguated into {@link ErrorCode.NotFound} or
 * {@link ErrorCode.InvalidTransition}.
 * @param id - The task's hex id.
 * @param input - The fix note to record.
 * @returns The updated recurring task mapped to the client-facing shape.
 */
export async function setFixNote(
  id: string,
  input: FixNoteInput,
): Promise<RecurringTask> {
  const recurringId = recurringIdSchema.parse(id);
  const parsed = fixNoteInputSchema.parse(input);
  const db = await getDb();
  const _id = new ObjectId(recurringId);

  const preImage = await recurringTasksCollection(db).findOne({ _id });

  const updated = await findOneAndUpdateZ(
    recurringTasksCollection(db),
    { _id, runState: RecurringRunState.Failed },
    { $set: { fixNote: parsed.note, updatedAt: new Date() } },
    recurringTaskDocumentSchema,
    { returnDocument: "after" },
  );

  if (!updated) {
    if (!preImage) {
      throw new AppError(ErrorCode.NotFound, `recurring task ${id} not found`);
    }
    throw new AppError(
      ErrorCode.InvalidTransition,
      `recurring task ${id} is not failed (runState "${preImage.runState}")`,
    );
  }

  return toClientRecurringTask(updated);
}

/**
 * Resets a failed task back to due so the next routine wake retries it: flips
 * `failed → idle`, sets `nextDueAt` to now (immediately due), and clears the
 * `failureReason`. The operator's `fixNote` is kept as history. Only a `failed`
 * task can be reset; otherwise {@link ErrorCode.NotFound} /
 * {@link ErrorCode.InvalidTransition}.
 * @param id - The task's hex id.
 * @returns The updated recurring task mapped to the client-facing shape.
 */
export async function resetToDue(id: string): Promise<RecurringTask> {
  const recurringId = recurringIdSchema.parse(id);
  const db = await getDb();
  const _id = new ObjectId(recurringId);
  const now = new Date();

  const preImage = await recurringTasksCollection(db).findOne({ _id });

  const updated = await findOneAndUpdateZ(
    recurringTasksCollection(db),
    { _id, runState: RecurringRunState.Failed },
    {
      $set: {
        runState: RecurringRunState.Idle,
        nextDueAt: now,
        updatedAt: now,
      },
      $unset: { failureReason: "" },
    },
    recurringTaskDocumentSchema,
    { returnDocument: "after" },
  );

  if (!updated) {
    if (!preImage) {
      throw new AppError(ErrorCode.NotFound, `recurring task ${id} not found`);
    }
    throw new AppError(
      ErrorCode.InvalidTransition,
      `recurring task ${id} is not failed (runState "${preImage.runState}")`,
    );
  }

  return toClientRecurringTask(updated);
}
