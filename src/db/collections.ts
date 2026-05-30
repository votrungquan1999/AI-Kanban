import type { Collection, Db } from "mongodb";
import type { CardDocument } from "@/cards/card.type";
import type { CardEventDocument } from "@/cards/card-event.type";

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

/** Typed accessor for the append-only `card_events` audit collection. */
export function cardEventsCollection(db: Db): Collection<CardEventDocument> {
  return db.collection<CardEventDocument>("card_events");
}
