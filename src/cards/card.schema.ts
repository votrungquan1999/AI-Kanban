import { z } from "zod";
import { OriginType, Status } from "@/cards/card.type";

/** A 24-character hex Mongo ObjectId string. */
export const cardIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/, "invalid card id");

/** Card status, restricted to the four board columns. */
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
  priority: z.number().int().default(0),
  origin: originSchema,
  dedupeKey: z.string().nullish(),
});

/** Caller-facing input (defaulted/optional fields may be omitted). */
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
/** Fully-parsed input (defaults applied). */
export type ParsedCreateTaskInput = z.output<typeof createTaskInputSchema>;
export type Origin = z.output<typeof originSchema>;
