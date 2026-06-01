import { ObjectId } from "mongodb";
import { z } from "zod";
import { OriginType, RunState, Status } from "@/cards/card.type";
import { EventOutcome } from "@/cards/card-event.type";
import { Caller } from "@/cards/transition-policy";

/**
 * Origin as stored in the DB. Distinct from the client `originSchema`: the
 * recurring `defId` is a real `ObjectId` here, not a hex string.
 */
const originDocumentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(OriginType.Manual) }),
  z.object({
    type: z.literal(OriginType.Recurring),
    defId: z.instanceof(ObjectId),
  }),
]);

/** Process info as stored in the DB. */
const processInfoSchema = z.object({
  pid: z.number(),
  startedAt: z.date(),
});

/** Last-error info as stored in the DB. */
const cardErrorInfoSchema = z.object({
  code: z.string(),
  message: z.string(),
  at: z.date(),
});

/** One workspace repo entry as stored in the DB (pure strings). */
const repoEntrySchema = z.object({
  repo: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
});

/**
 * Validates a raw `cards` document read out of MongoDB. Mirrors the
 * `CardDocument` interface exactly: `ObjectId`/`Date` stay as BSON instances
 * (no coercion), so a drifted doc (e.g. a stringified `_id` or date) fails to
 * parse. `description` is `.optional()` — an omitted value is absent, not null
 * (cards are inserted with `ignoreUndefined: true`).
 */
export const cardDocumentSchema = z.object({
  _id: z.instanceof(ObjectId),
  number: z.number(),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(Status),
  priority: z.number(),
  origin: originDocumentSchema,
  dedupeKey: z.string().nullable(),
  runState: z.enum(RunState),
  process: processInfoSchema.nullable(),
  attempts: z.number(),
  restarts: z.number(),
  nextStartAfter: z.date().nullable(),
  lastError: cardErrorInfoSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  pickedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  workspacePath: z.string().nullable(),
  repos: z.array(repoEntrySchema),
});

/** Validates a raw `card_events` audit document read out of MongoDB. */
export const cardEventDocumentSchema = z.object({
  _id: z.instanceof(ObjectId),
  cardId: z.instanceof(ObjectId),
  from: z.enum(Status).nullable(),
  to: z.enum(Status),
  caller: z.enum(Caller),
  at: z.date(),
  outcome: z.enum(EventOutcome),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
