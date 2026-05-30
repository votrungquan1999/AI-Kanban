import { type Db, ObjectId } from "mongodb";
import { cardEventDocumentSchema } from "@/cards/card.document.schema";
import type { Status } from "@/cards/card.type";
import type {
  CardEventDocument,
  CardEventError,
  EventOutcome,
} from "@/cards/card-event.type";
import type { Caller } from "@/cards/transition-policy";
import { cardEventsCollection } from "@/db/collections";
import { findManyZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/** The caller-supplied fields of a card event (`_id` and `at` are generated). */
interface CardEventInput {
  cardId: ObjectId;
  from: Status | null;
  to: Status;
  caller: Caller;
  outcome: EventOutcome;
  error: CardEventError | null;
}

/**
 * Appends one audit event to the `card_events` collection, stamping `_id` and
 * `at`. Called from the card lifecycle choke points (create + transitions).
 * @param db - The database handle.
 * @param event - The event fields to record.
 */
export async function emitCardEvent(
  db: Db,
  event: CardEventInput,
): Promise<void> {
  const doc: CardEventDocument = {
    _id: new ObjectId(),
    at: new Date(),
    ...event,
  };
  await cardEventsCollection(db).insertOne(doc);
}

/**
 * Reads a card's audit events in chronological order (oldest first). Sorted by
 * `at` then `_id` so events written in the same millisecond keep a stable,
 * insertion-ordered sequence.
 * @param cardId - The card's hex id.
 * @returns The card's events, parsed and validated, oldest first.
 */
export async function listCardEvents(
  cardId: string,
): Promise<CardEventDocument[]> {
  const db = await getDb();
  return findManyZ(
    cardEventsCollection(db),
    { cardId: new ObjectId(cardId) },
    cardEventDocumentSchema,
    { sort: { at: 1, _id: 1 } },
  );
}
