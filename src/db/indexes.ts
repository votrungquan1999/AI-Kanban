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

/** One index that could not be built, tagged with which index it was. */
export interface IndexBuildFailure {
  /** Stable name for the index, e.g. `cards.text` — safe to match on. */
  index: string;
  error: Error;
}

/**
 * Runs one `createIndex` call in isolation, logging the failure and collecting
 * it into `failures` rather than throwing — an unrelated index (e.g. search)
 * must not go missing because another failed to build. The failure carries the
 * index's name so a caller can tell whether the failure concerns it at all.
 * @param failures - Accumulator the caught failure is appended to.
 * @param index - Stable name for the index being built.
 * @param build - Performs the single `createIndex` call.
 */
async function tryCreateIndex(
  failures: IndexBuildFailure[],
  index: string,
  build: () => Promise<unknown>,
): Promise<void> {
  try {
    await build();
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    console.error(`Index build failed (${index}):`, wrapped);
    failures.push({ index, error: wrapped });
  }
}

/** The text index's stable name — `listCards` matches on it (D13). */
export const TEXT_INDEX = "cards.text";

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
 * @returns Every failure caught along the way (empty when all indexes built),
 * each tagged with its index name so a caller (`mongo.ts`) can record what —
 * if anything — failed, and callers can tell whether it concerns them.
 */
export async function bootstrapIndexes(db: Db): Promise<IndexBuildFailure[]> {
  const errors: IndexBuildFailure[] = [];
  const cards = cardsCollection(db);

  await tryCreateIndex(errors, "cards.board", () =>
    cards.createIndex({ status: 1, priority: -1, createdAt: 1 }),
  );
  await tryCreateIndex(errors, "cards.number", () =>
    cards.createIndex({ number: 1 }, { unique: true }),
  );

  // Keyword search over title + description: ranked, word-based via $text,
  // not substring. Mongo allows only one text index per collection, so both
  // fields go in this single call. Built before dedupeKey so search exists
  // even if the dedupeKey build below fails.
  await tryCreateIndex(errors, TEXT_INDEX, () =>
    cards.createIndex({ title: "text", description: "text" }),
  );

  await tryCreateIndex(errors, "cards.dedupeKey", () =>
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
  await tryCreateIndex(errors, "card_events.byCard", () =>
    cardEventsCollection(db).createIndex({ cardId: 1, at: 1 }),
  );

  const recurringTasks = recurringTasksCollection(db);

  // Dueness/claim scan: enabled + idle + nextDueAt-reached (equality, equality,
  // range — the prefix order the due-list and claim filters query on).
  await tryCreateIndex(errors, "recurring.due", () =>
    recurringTasks.createIndex({ enabled: 1, runState: 1, nextDueAt: 1 }),
  );
  await tryCreateIndex(errors, "recurring.number", () =>
    recurringTasks.createIndex({ number: 1 }, { unique: true }),
  );

  // Chronological read-back of a recurring task's run history.
  await tryCreateIndex(errors, "recurring_runs.byTask", () =>
    recurringRunsCollection(db).createIndex({ recurringId: 1, at: 1 }),
  );

  return errors;
}
