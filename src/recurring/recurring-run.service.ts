import { type Db, ObjectId } from "mongodb";
import { recurringRunsCollection } from "@/db/collections";
import { findManyZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";
import type { RecurringOutcome } from "@/recurring/recurring.type";
import { recurringRunDocumentSchema } from "@/recurring/recurring-run.document.schema";
import type { RecurringRunDocument } from "@/recurring/recurring-run.type";

/** Input for appending one run-history row (the audit of an execution). */
export interface EmitRecurringRunInput {
  recurringId: ObjectId;
  startedAt: Date;
  finishedAt: Date;
  outcome: RecurringOutcome;
  note?: string;
  error?: string;
}

/**
 * Appends one append-only run-history row for a recurring task. The row's `at`
 * timestamp is the finish time, so chronological reads order runs by completion.
 * Inserted with `ignoreUndefined` so an absent `note`/`error` is not stored as
 * BSON null.
 * @param db - The database handle.
 * @param input - The run details to record.
 */
export async function emitRecurringRun(
  db: Db,
  input: EmitRecurringRunInput,
): Promise<void> {
  await recurringRunsCollection(db).insertOne(
    {
      _id: new ObjectId(),
      recurringId: input.recurringId,
      at: input.finishedAt,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      outcome: input.outcome,
      note: input.note,
      error: input.error,
    },
    { ignoreUndefined: true },
  );
}

/**
 * Reads the full run history for a recurring task in chronological order
 * (oldest first), validating each row on read. Returns documents (no client
 * mapper) like the card audit log; the surface maps them when rendering.
 * @param recurringId - The task's hex id.
 * @returns The task's run-history rows, oldest first.
 */
export async function listRecurringRuns(
  recurringId: string,
): Promise<RecurringRunDocument[]> {
  const db = await getDb();
  return findManyZ(
    recurringRunsCollection(db),
    { recurringId: new ObjectId(recurringId) },
    recurringRunDocumentSchema,
    { sort: { at: 1, _id: 1 } },
  );
}
