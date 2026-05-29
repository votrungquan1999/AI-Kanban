import type { Db } from "mongodb";
import { countersCollection } from "@/db/collections";

const CARDS_COUNTER_ID = "cards";

/**
 * Atomically returns the next gap-free monotonic card number (1, 2, 3, ...)
 * via a single `$inc` upsert on the `counters` document `{ _id: "cards" }`.
 * Concurrent callers never receive the same number.
 */
export async function nextNumber(db: Db): Promise<number> {
  const counter = await countersCollection(db).findOneAndUpdate(
    { _id: CARDS_COUNTER_ID },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );

  if (!counter) {
    throw new Error("counter update returned no document");
  }

  return counter.seq;
}
