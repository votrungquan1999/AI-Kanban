import { ObjectId } from "mongodb";
import { z } from "zod";
import { RecurringOutcome } from "@/recurring/recurring.type";

/**
 * Validates a raw `recurring_runs` document read out of MongoDB. Mirrors the
 * {@link RecurringRunDocument} interface: `ObjectId`/`Date` stay as BSON
 * instances (no coercion). `note`/`error` are `.optional()` — absent, not null
 * (rows are inserted with `ignoreUndefined: true`).
 */
export const recurringRunDocumentSchema = z.object({
  _id: z.instanceof(ObjectId),
  recurringId: z.instanceof(ObjectId),
  at: z.date(),
  startedAt: z.date(),
  finishedAt: z.date(),
  outcome: z.enum(RecurringOutcome),
  note: z.string().optional(),
  error: z.string().optional(),
});
