import { settingsCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";
import { settingsDocumentSchema } from "@/settings/settings.document.schema";

/** The fixed `_id` of the singleton board settings document. */
const SETTINGS_ID = "board";

/** The default Blocked auto-move countdown seeded on first read: 2 hours. */
const DEFAULT_BLOCK_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Reads the board-wide default Blocked auto-move countdown (in milliseconds),
 * lazily seeding the 2-hour default on first access. The upsert uses
 * `$setOnInsert` so an already-customized value is never overwritten.
 * @returns The default block interval in milliseconds.
 */
export async function getDefaultBlockInterval(): Promise<number> {
  const db = await getDb();
  const settings = await findOneAndUpdateZ(
    settingsCollection(db),
    { _id: SETTINGS_ID },
    { $setOnInsert: { defaultBlockIntervalMs: DEFAULT_BLOCK_INTERVAL_MS } },
    settingsDocumentSchema,
    { upsert: true, returnDocument: "after" },
  );

  if (!settings) {
    throw new Error("settings upsert returned no document");
  }

  return settings.defaultBlockIntervalMs;
}

/**
 * Sets the board-wide default Blocked auto-move countdown (in milliseconds).
 * @param intervalMs - The new default block interval in milliseconds.
 * @returns The persisted default block interval in milliseconds.
 */
export async function updateDefaultBlockInterval(
  intervalMs: number,
): Promise<number> {
  const db = await getDb();
  const settings = await findOneAndUpdateZ(
    settingsCollection(db),
    { _id: SETTINGS_ID },
    { $set: { defaultBlockIntervalMs: intervalMs } },
    settingsDocumentSchema,
    { upsert: true, returnDocument: "after" },
  );

  if (!settings) {
    throw new Error("settings update returned no document");
  }

  return settings.defaultBlockIntervalMs;
}
