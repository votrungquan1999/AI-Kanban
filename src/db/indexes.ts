import type { Db } from "mongodb";
import { Status } from "@/cards/card.type";
import {
  cardEventsCollection,
  cardsCollection,
  recurringRunsCollection,
  recurringTasksCollection,
} from "@/db/collections";

/**
 * Statuses considered "open" — a dedupeKey may only repeat once these clear.
 * Exported so {@link updateTaskStatus}'s force path (card.service.ts) can find
 * the current open holder of a colliding dedupeKey — single source of truth
 * with the partial-unique index below, no duplicated status trio to drift.
 */
export const OPEN_STATUSES = [
  Status.Todo,
  Status.InProgress,
  Status.NeedReview,
];

/**
 * Runs one `createIndex` call in isolation, logging the failure and collecting
 * it into `errors` rather than throwing — an unrelated index (e.g. search) must
 * not go missing because another failed to build.
 * @param errors - Accumulator the caught error is appended to.
 * @param build - Performs the single `createIndex` call.
 */
async function tryCreateIndex(
  errors: Error[],
  build: () => Promise<unknown>,
): Promise<void> {
  try {
    await build();
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    console.error("Index build failed:", wrapped);
    errors.push(wrapped);
  }
}

/**
 * Creates the `cards` + `recurring_tasks` indexes idempotently (safe to run on
 * every boot): the board/pickup composite, the unique `number`, the
 * title+description text index (keyword search), the partial-unique
 * `dedupeKey` (enforced only while a card is open), the recurring
 * dueness/claim composite, the unique recurring `number`, and the run-history
 * index. Each index is isolated (see {@link tryCreateIndex}) so a failure on
 * one never costs another; the text index is built before `dedupeKey` — the
 * one call known to be at risk on prod data — so search survives even if
 * isolation were ever weakened.
 * @returns Every error caught along the way (empty when all indexes built),
 * so a caller (`mongo.ts`) can record what — if anything — failed.
 */
export async function bootstrapIndexes(db: Db): Promise<Error[]> {
  const errors: Error[] = [];
  const cards = cardsCollection(db);

  await tryCreateIndex(errors, () =>
    cards.createIndex({ status: 1, priority: -1, createdAt: 1 }),
  );
  await tryCreateIndex(errors, () =>
    cards.createIndex({ number: 1 }, { unique: true }),
  );

  // Keyword search over title + description: ranked, word-based via $text,
  // not substring. Mongo allows only one text index per collection, so both
  // fields go in this single call. Built before dedupeKey so search exists
  // even if the dedupeKey build below fails.
  await tryCreateIndex(errors, () =>
    cards.createIndex({ title: "text", description: "text" }),
  );

  await tryCreateIndex(errors, () =>
    cards.createIndex(
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
    ),
  );

  // Chronological read-back of a card's audit events.
  await tryCreateIndex(errors, () =>
    cardEventsCollection(db).createIndex({ cardId: 1, at: 1 }),
  );

  const recurringTasks = recurringTasksCollection(db);

  // Dueness/claim scan: enabled + idle + nextDueAt-reached (equality, equality,
  // range — the prefix order the due-list and claim filters query on).
  await tryCreateIndex(errors, () =>
    recurringTasks.createIndex({ enabled: 1, runState: 1, nextDueAt: 1 }),
  );
  await tryCreateIndex(errors, () =>
    recurringTasks.createIndex({ number: 1 }, { unique: true }),
  );

  // Chronological read-back of a recurring task's run history.
  await tryCreateIndex(errors, () =>
    recurringRunsCollection(db).createIndex({ recurringId: 1, at: 1 }),
  );

  return errors;
}
