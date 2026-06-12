import { ObjectId } from "mongodb";
import { z } from "zod";
import { OriginType, RunState, Status } from "@/cards/card.type";
import {
  CardEventKind,
  EditableField,
  EventOutcome,
} from "@/cards/card-event.type";
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
  // optional AND nullable: legacy docs OMIT the field (absent ≠ null), so
  // `.optional()` lets them parse; the mapper coerces the absent case to null.
  blockedUntil: z.date().nullable().optional(),
  workspacePath: z.string().nullable(),
  repos: z.array(repoEntrySchema),
});

/** Fields shared by every `card_events` audit document. */
const baseEventSchema = z.object({
  _id: z.instanceof(ObjectId),
  cardId: z.instanceof(ObjectId),
  caller: z.enum(Caller),
  at: z.date(),
  outcome: z.enum(EventOutcome),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

/** A status-change audit row (create / move). `from` is null for a create. */
const statusTransitionEventSchema = baseEventSchema.extend({
  kind: z.literal(CardEventKind.StatusTransition),
  from: z.enum(Status).nullable(),
  to: z.enum(Status),
});

/** One audited field change with its stringified old/new values. */
const fieldChangeSchema = z.object({
  field: z.enum(EditableField),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

/** A field-edit audit row carrying the per-field diff in `changes`. */
const fieldEditEventSchema = baseEventSchema.extend({
  kind: z.literal(CardEventKind.FieldEdit),
  changes: z.array(fieldChangeSchema).min(1),
});

/**
 * Validates a raw `card_events` audit document read out of MongoDB. A
 * discriminated union on `kind`; the `preprocess` step injects
 * `kind: "status_transition"` into legacy rows that predate the discriminator
 * (written before field-edit auditing) so they keep parsing with no migration.
 */
export const cardEventDocumentSchema = z.preprocess(
  (doc) => {
    if (doc && typeof doc === "object" && !("kind" in doc)) {
      return { kind: CardEventKind.StatusTransition, ...doc };
    }
    return doc;
  },
  z.discriminatedUnion("kind", [
    statusTransitionEventSchema,
    fieldEditEventSchema,
  ]),
);
