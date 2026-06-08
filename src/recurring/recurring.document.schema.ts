import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  RecurringOutcome,
  RecurringRunState,
} from "@/recurring/recurring.type";

/**
 * Validates a raw `recurring_tasks` document read out of MongoDB. Mirrors the
 * {@link RecurringTaskDocument} interface exactly: `ObjectId`/`Date` stay as
 * BSON instances (no coercion), so a drifted doc (e.g. a stringified `_id` or
 * date) fails to parse and surfaces as schema drift on read.
 */
export const recurringTaskDocumentSchema = z.object({
  _id: z.instanceof(ObjectId),
  number: z.number(),
  title: z.string(),
  instruction: z.string(),
  everyHours: z.number(),
  enabled: z.boolean(),
  runState: z.enum(RecurringRunState),
  nextDueAt: z.date(),
  lastRunAt: z.date().nullable(),
  lastOutcome: z.enum(RecurringOutcome).nullable(),
  failureReason: z.string().optional(),
  fixNote: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
