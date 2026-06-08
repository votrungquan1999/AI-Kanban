import type {
  RecurringTask,
  RecurringTaskDocument,
} from "@/recurring/recurring.type";

/**
 * Converts a stored {@link RecurringTaskDocument} into the clean client-facing
 * {@link RecurringTask}: hex string id, ISO-string timestamps, no raw document
 * fields.
 * @param doc - The stored recurring task document.
 * @returns The client-facing recurring task.
 */
export function toClientRecurringTask(
  doc: RecurringTaskDocument,
): RecurringTask {
  return {
    id: doc._id.toHexString(),
    number: doc.number,
    title: doc.title,
    instruction: doc.instruction,
    everyHours: doc.everyHours,
    enabled: doc.enabled,
    runState: doc.runState,
    nextDueAt: doc.nextDueAt.toISOString(),
    lastRunAt: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
    lastOutcome: doc.lastOutcome,
    failureReason: doc.failureReason,
    fixNote: doc.fixNote,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
