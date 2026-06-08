import { ObjectId } from "mongodb";
import { AppError, ErrorCode } from "@/cards/errors";
import { recurringTasksCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";
import { computeNextDueAt } from "@/recurring/compute-next-due-at";
import { recurringTaskDocumentSchema } from "@/recurring/recurring.document.schema";
import { toClientRecurringTask } from "@/recurring/recurring.mapper";
import { recurringIdSchema } from "@/recurring/recurring.schema";
import {
  RecurringOutcome,
  RecurringRunState,
  type RecurringTask,
} from "@/recurring/recurring.type";
import { emitRecurringRun } from "@/recurring/recurring-run.service";

/** Options for {@link completeRecurring}. */
interface CompleteRecurringOptions {
  note?: string;
}

/** Options for {@link failRecurring}. */
interface FailRecurringOptions {
  error: string;
}

/**
 * Marks a running recurring task complete: flips it back to `idle`, rolls
 * `nextDueAt` forward by `everyHours`, records `lastOutcome = success`, and
 * appends a success run-history row (whose `startedAt` is the claim's
 * `lastRunAt`). A task that is not running matches nothing and is disambiguated
 * into {@link ErrorCode.NotFound} (missing) or {@link ErrorCode.InvalidTransition}.
 * @param id - The task's hex id.
 * @param options - Optional short success `note` recorded on the run row.
 * @returns The updated recurring task mapped to the client-facing shape.
 */
export async function completeRecurring(
  id: string,
  options: CompleteRecurringOptions = {},
): Promise<RecurringTask> {
  const recurringId = recurringIdSchema.parse(id);
  const db = await getDb();
  const _id = new ObjectId(recurringId);
  const now = new Date();

  // Pre-image supplies the claim's startedAt + the interval, and disambiguates
  // a miss. Raw read so a drifted doc cannot mask NotFound/InvalidTransition.
  const preImage = await recurringTasksCollection(db).findOne({ _id });

  const updated = await findOneAndUpdateZ(
    recurringTasksCollection(db),
    { _id, runState: RecurringRunState.Running },
    {
      $set: {
        runState: RecurringRunState.Idle,
        nextDueAt: computeNextDueAt(preImage?.everyHours ?? 0, now),
        lastOutcome: RecurringOutcome.Success,
        updatedAt: now,
      },
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
      `recurring task ${id} is not running (runState "${preImage.runState}")`,
    );
  }

  await emitRecurringRun(db, {
    recurringId: _id,
    startedAt: preImage?.lastRunAt ?? now,
    finishedAt: now,
    outcome: RecurringOutcome.Success,
    note: options.note,
  });

  return toClientRecurringTask(updated);
}

/**
 * Marks a running recurring task failed: flips it to `failed`, stores the
 * `failureReason`, records `lastOutcome = failure`, and appends a failure
 * run-history row. A failed task is no longer due (the routine skips it) until
 * an operator resets it. No auto-retry, no backoff. A task that is not running
 * is disambiguated into {@link ErrorCode.NotFound} or
 * {@link ErrorCode.InvalidTransition}.
 * @param id - The task's hex id.
 * @param options - Carries the short `error` reason recorded on the task + run.
 * @returns The updated recurring task mapped to the client-facing shape.
 */
export async function failRecurring(
  id: string,
  options: FailRecurringOptions,
): Promise<RecurringTask> {
  const recurringId = recurringIdSchema.parse(id);
  const db = await getDb();
  const _id = new ObjectId(recurringId);
  const now = new Date();

  const preImage = await recurringTasksCollection(db).findOne({ _id });

  const updated = await findOneAndUpdateZ(
    recurringTasksCollection(db),
    { _id, runState: RecurringRunState.Running },
    {
      $set: {
        runState: RecurringRunState.Failed,
        lastOutcome: RecurringOutcome.Failure,
        failureReason: options.error,
        updatedAt: now,
      },
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
      `recurring task ${id} is not running (runState "${preImage.runState}")`,
    );
  }

  await emitRecurringRun(db, {
    recurringId: _id,
    startedAt: preImage?.lastRunAt ?? now,
    finishedAt: now,
    outcome: RecurringOutcome.Failure,
    error: options.error,
  });

  return toClientRecurringTask(updated);
}
