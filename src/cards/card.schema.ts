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
 * Validated input for a session creating a card that tracks its own work.
 * Separate from {@link createTaskInputSchema} (type-separation rule): no
 * origin/priority, but carries the session's tags + handle. `tags` allows
 * empty and dedupes, first-occurrence order kept (D15); `sessionId` is
 * optional for non-session (e.g. operator-driven) creation.
 */
export const createCardInputSchema = z.object({
  title: z.string().min(1, "title is required"),
  description: z.string().optional(),
  // Dedupe, first-occurrence order kept (D15) — matches the set diffFields compares.
  tags: z.array(z.string()).transform((tags) => [...new Set(tags)]),
  sessionId: z.string().optional(),
  // Trim then collapse empty to undefined (D8) — matches the existing
  // omit-then-mapper-coerces-to-null convention rather than a literal null.
  nextAction: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

/** Caller-facing input for creating a session-tracked card. */
export type CreateCardInput = z.input<typeof createCardInputSchema>;
/** Fully-parsed session-tracked card input. */
export type ParsedCreateCardInput = z.output<typeof createCardInputSchema>;

/** A single progress note's text; must be non-empty. */
export const progressNoteSchema = z.string().min(1, "note is required");

/** A single decision's text; trimmed, then must be non-empty (D10 R1). */
export const decisionTextSchema = z
  .string()
  .trim()
  .min(1, "decision is required");

/** The array index of a decision within a card's `decisions[]` (D10 R8). */
export const decisionIndexSchema = z.number().int().min(0);

/** The index of the decision that replaced an outdated one; optional. */
export const supersededByIndexSchema = z.number().int().min(0).optional();

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
  // Trimmed (D8); empty/whitespace signals the service to clear the field
  // (mirrors `description`'s blank-clears convention).
  nextAction: z.string().trim().optional(),
  // Order-insensitive change detection (D13); dedupe, first-occurrence order
  // kept (D15) so a duplicate-bearing patch can't be judged a no-op while
  // storage silently drifts.
  tags: z
    .array(z.string())
    .optional()
    .transform((tags) => (tags === undefined ? undefined : [...new Set(tags)])),
});

/** Caller-facing edit input (any subset of the editable fields). */
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
/** Fully-parsed edit input. */
export type ParsedUpdateTaskInput = z.output<typeof updateTaskInputSchema>;
