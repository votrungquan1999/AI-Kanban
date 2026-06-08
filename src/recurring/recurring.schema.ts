import { z } from "zod";

/** A 24-character hex Mongo ObjectId string identifying a recurring task. */
export const recurringIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/, "invalid recurring task id");

/**
 * Validated input for creating a recurring task; the shared client + server
 * contract. `everyHours` is a positive integer (presets resolve to 1/24/168);
 * `title` and `instruction` are required non-empty strings.
 */
export const createRecurringInputSchema = z.object({
  title: z.string().min(1, "title is required"),
  instruction: z.string().min(1, "instruction is required"),
  everyHours: z.number().int().positive("everyHours must be positive"),
});

/**
 * Validated input for recording an operator fix note on a failed task. Explicit
 * (not `.partial()`); the note is a required non-empty string.
 */
export const fixNoteInputSchema = z.object({
  note: z.string().min(1, "fix note is required"),
});

/** Caller-facing fix-note input. */
export type FixNoteInput = z.input<typeof fixNoteInputSchema>;

/** Caller-facing create input. */
export type CreateRecurringInput = z.input<typeof createRecurringInputSchema>;
/** Fully-parsed create input. */
export type ParsedCreateRecurringInput = z.output<
  typeof createRecurringInputSchema
>;
