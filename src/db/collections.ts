import type { Collection, Db } from "mongodb";
import type { CardDocument } from "@/cards/card.type";
import type { CardEventDocument } from "@/cards/card-event.type";
import type { RecurringTaskDocument } from "@/recurring/recurring.type";
import type { RecurringRunDocument } from "@/recurring/recurring-run.type";
import type { SettingsDocument } from "@/settings/settings.type";

/** A monotonic counter document, e.g. `{ _id: "cards", seq: 42 }`. */
export interface CounterDocument {
  _id: string;
  seq: number;
}

/** Typed accessor for the `cards` collection. */
export function cardsCollection(db: Db): Collection<CardDocument> {
  return db.collection<CardDocument>("cards");
}

/** Typed accessor for the `counters` collection. */
export function countersCollection(db: Db): Collection<CounterDocument> {
  return db.collection<CounterDocument>("counters");
}

/** Typed accessor for the singleton `settings` collection. */
export function settingsCollection(db: Db): Collection<SettingsDocument> {
  return db.collection<SettingsDocument>("settings");
}

/** Typed accessor for the append-only `card_events` audit collection. */
export function cardEventsCollection(db: Db): Collection<CardEventDocument> {
  return db.collection<CardEventDocument>("card_events");
}

/** Typed accessor for the `recurring_tasks` collection. */
export function recurringTasksCollection(
  db: Db,
): Collection<RecurringTaskDocument> {
  return db.collection<RecurringTaskDocument>("recurring_tasks");
}

/** Typed accessor for the append-only `recurring_runs` history collection. */
export function recurringRunsCollection(
  db: Db,
): Collection<RecurringRunDocument> {
  return db.collection<RecurringRunDocument>("recurring_runs");
}
