import { z } from "zod";

/**
 * Validates the singleton board `settings` document read out of MongoDB.
 * The `_id` is the fixed string `"board"`; `defaultBlockIntervalMs` is the
 * board-wide Blocked auto-move countdown in milliseconds.
 */
export const settingsDocumentSchema = z.object({
  _id: z.string(),
  defaultBlockIntervalMs: z.number(),
});
