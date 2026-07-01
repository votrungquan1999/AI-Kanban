import { z } from "zod";
import { OriginType, Status } from "@/cards/card.type";

/** A 24-character hex Mongo ObjectId string. */
export const cardIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/, "invalid card id");

/** Card status, accepting any lifecycle status (board columns + archived). */
export const statusSchema = z.enum(Status);

/** Where a card came from (discriminated on `type`). */
export const originSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(OriginType.Manual) }),
  z.object({ type: z.literal(OriginType.Recurring), defId: cardIdSchema }),
]);

/** Validated input for creating a card; the shared client + server contract. */
export const createTaskInputSchema = z.object({
  title: z.string().min(1, "title is required"),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(3).default(0),
  origin: originSchema,
  dedupeKey: z.string().nullish(),
});

/** Caller-facing input (defaulted/optional fields may be omitted). */
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
/** Fully-parsed input (defaults applied). */
export type ParsedCreateTaskInput = z.output<typeof createTaskInputSchema>;
export type Origin = z.output<typeof originSchema>;

/**
 * Validated input for a session creating a card that tracks its own work. Kept
 * separate from {@link createTaskInputSchema} (type-separation rule): no origin,
 * no priority, but carries the session's labels and handle. `tags` accepts an
 * empty array (no `.min(1)`) and is stored verbatim; `sessionId` is required.
 */
export const createCardInputSchema = z.object({
  title: z.string().min(1, "title is required"),
  description: z.string().optional(),
  tags: z.array(z.string()),
  sessionId: z.string().min(1, "sessionId is required"),
});

/** Caller-facing input for creating a session-tracked card. */
export type CreateCardInput = z.input<typeof createCardInputSchema>;
/** Fully-parsed session-tracked card input. */
export type ParsedCreateCardInput = z.output<typeof createCardInputSchema>;

/** A single progress note's text; must be non-empty. */
export const progressNoteSchema = z.string().min(1, "note is required");

/**
 * Validated input for editing a card's core fields. Every field is optional (a
 * partial patch); only the keys present are changed. Fields are defined
 * explicitly — NOT via `createTaskInputSchema.partial()` — so priority's
 * create-time `.default(0)` does NOT leak in and silently force priority to 0 on
 * a patch that does not touch it. A blank `description` is accepted here (the
 * service decides whether to clear it).
 */
export const updateTaskInputSchema = z.object({
  title: z.string().min(1, "title is required").optional(),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(3).optional(),
});

/** Caller-facing edit input (any subset of the editable fields). */
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
/** Fully-parsed edit input. */
export type ParsedUpdateTaskInput = z.output<typeof updateTaskInputSchema>;
