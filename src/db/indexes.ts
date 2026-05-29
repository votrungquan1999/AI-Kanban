import type { Db } from "mongodb";
import { Status } from "@/cards/card.type";
import { cardsCollection } from "@/db/collections";

/** Statuses considered "open" — a dedupeKey may only repeat once these clear. */
const OPEN_STATUSES = [Status.Todo, Status.InProgress, Status.NeedReview];

/**
 * Creates the `cards` indexes idempotently (safe to run on every boot):
 * the board/pickup composite, the unique `number`, and the partial-unique
 * `dedupeKey` (enforced only while a card is open).
 */
export async function bootstrapIndexes(db: Db): Promise<void> {
  const cards = cardsCollection(db);

  await cards.createIndex({ status: 1, priority: -1, createdAt: 1 });
  await cards.createIndex({ number: 1 }, { unique: true });
  await cards.createIndex(
    { dedupeKey: 1 },
    {
      unique: true,
      // Only enforce uniqueness among OPEN cards that actually carry a string
      // dedupeKey — manual cards (dedupeKey: null) must never collide.
      partialFilterExpression: {
        dedupeKey: { $type: "string" },
        status: { $in: OPEN_STATUSES },
      },
    },
  );
}
