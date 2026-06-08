import { ObjectId } from "mongodb";
import { AppError, ErrorCode } from "@/cards/errors";
import { recurringTasksCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";
import { recurringTaskDocumentSchema } from "@/recurring/recurring.document.schema";
import { toClientRecurringTask } from "@/recurring/recurring.mapper";
import { recurringIdSchema } from "@/recurring/recurring.schema";
import {
  RecurringRunState,
  type RecurringTask,
} from "@/recurring/recurring.type";

/**
 * Atomically claims a due recurring task for execution by a routine. A single
 * `findOneAndUpdate({_id, enabled, runState: idle, nextDueAt <= now}, …)` flips
 * the task to `running` and stamps `lastRunAt` — that single-document filter IS
 * the no-double-claim guarantee. A claim that matches nothing is disambiguated
 * via a raw pre-image read into a distinct error: {@link ErrorCode.NotFound}
 * (missing), {@link ErrorCode.AlreadyRunning} (not idle), or
 * {@link ErrorCode.NotDue} (disabled or not yet due) — so the routine can branch.
 * @param id - The task's hex id.
 * @returns The claimed task mapped to the client-facing shape.
 */
export async function startRecurring(id: string): Promise<RecurringTask> {
  const recurringId = recurringIdSchema.parse(id);
  const db = await getDb();
  const _id = new ObjectId(recurringId);
  const now = new Date();

  const claimed = await findOneAndUpdateZ(
    recurringTasksCollection(db),
    {
      _id,
      enabled: true,
      runState: RecurringRunState.Idle,
      nextDueAt: { $lte: now },
    },
    { $set: { runState: RecurringRunState.Running, lastRunAt: now } },
    recurringTaskDocumentSchema,
    { returnDocument: "after" },
  );

  if (!claimed) {
    // The claim matched nothing: read the raw pre-image to disambiguate the
    // reason into a distinct error the routine can branch on.
    const preImage = await recurringTasksCollection(db).findOne({ _id });
    if (!preImage) {
      throw new AppError(ErrorCode.NotFound, `recurring task ${id} not found`);
    }
    if (preImage.runState !== RecurringRunState.Idle) {
      throw new AppError(
        ErrorCode.AlreadyRunning,
        `recurring task ${id} is not idle (runState "${preImage.runState}")`,
      );
    }
    throw new AppError(
      ErrorCode.NotDue,
      `recurring task ${id} is disabled or not yet due`,
    );
  }

  return toClientRecurringTask(claimed);
}
