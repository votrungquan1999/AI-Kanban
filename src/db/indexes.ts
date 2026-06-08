import type { Db } from "mongodb";
import { Status } from "@/cards/card.type";
import {
  cardEventsCollection,
  cardsCollection,
  recurringRunsCollection,
  recurringTasksCollection,
} from "@/db/collections";

/** Statuses considered "open" — a dedupeKey may only repeat once these clear. */
const OPEN_STATUSES = [Status.Todo, Status.InProgress, Status.NeedReview];

/**
 * Creates the `cards` + `recurring_tasks` indexes idempotently (safe to run on
 * every boot): the board/pickup composite, the unique `number`, the
 * partial-unique `dedupeKey` (enforced only while a card is open), the recurring
 * dueness/claim composite, the unique recurring `number`, and the run-history
 * index.
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

  // Chronological read-back of a card's audit events.
  await cardEventsCollection(db).createIndex({ cardId: 1, at: 1 });

  const recurringTasks = recurringTasksCollection(db);

  // Dueness/claim scan: enabled + idle + nextDueAt-reached (equality, equality,
  // range — the prefix order the due-list and claim filters query on).
  await recurringTasks.createIndex({ enabled: 1, runState: 1, nextDueAt: 1 });
  await recurringTasks.createIndex({ number: 1 }, { unique: true });

  // Chronological read-back of a recurring task's run history.
  await recurringRunsCollection(db).createIndex({ recurringId: 1, at: 1 });
}
