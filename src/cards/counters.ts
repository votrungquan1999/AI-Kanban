import type { Db } from "mongodb";
import { countersCollection } from "@/db/collections";

/**
 * Atomically returns the next gap-free monotonic number (1, 2, 3, ...) for the
 * given counter, via a single `$inc` upsert on the `counters` document
 * `{ _id: counterId }`. Each `counterId` (e.g. `"cards"`, `"recurring_tasks"`)
 * has an independent sequence. Concurrent callers never receive the same number.
 * @param db - The database handle.
 * @param counterId - The counter document id whose sequence to advance.
 * @returns The next monotonic number for that counter.
 */
export async function nextNumber(db: Db, counterId: string): Promise<number> {
  const counter = await countersCollection(db).findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );

  if (!counter) {
    throw new Error("counter update returned no document");
  }

  return counter.seq;
}
