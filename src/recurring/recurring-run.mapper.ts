import type { RecurringOutcome } from "@/recurring/recurring.type";
import type { RecurringRunDocument } from "@/recurring/recurring-run.type";

/** A run-history row as exposed to the client — never expose raw documents. */
export interface RecurringRun {
  id: string;
  recurringId: string;
  at: string;
  startedAt: string;
  finishedAt: string;
  outcome: RecurringOutcome;
  note?: string;
  error?: string;
}

/**
 * Converts a stored {@link RecurringRunDocument} into the client-facing
 * {@link RecurringRun}: hex string ids, ISO-string timestamps, no ObjectId/Date
 * (which are not serializable across the RSC → client boundary).
 * @param doc - The stored run-history document.
 * @returns The client-facing run-history row.
 */
export function toClientRecurringRun(doc: RecurringRunDocument): RecurringRun {
  return {
    id: doc._id.toHexString(),
    recurringId: doc.recurringId.toHexString(),
    at: doc.at.toISOString(),
    startedAt: doc.startedAt.toISOString(),
    finishedAt: doc.finishedAt.toISOString(),
    outcome: doc.outcome,
    note: doc.note,
    error: doc.error,
  };
}
