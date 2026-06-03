import { type Db, ObjectId } from "mongodb";
import { cardEventDocumentSchema } from "@/cards/card.document.schema";
import type { Status } from "@/cards/card.type";
import {
  type CardEventDocument,
  type CardEventError,
  CardEventKind,
  EventOutcome,
  type FieldChange,
  type FieldEditEventDocument,
  type StatusTransitionEventDocument,
} from "@/cards/card-event.type";
import type { Caller } from "@/cards/transition-policy";
import { cardEventsCollection } from "@/db/collections";
import { findManyZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/**
 * The caller-supplied fields of a status-transition event (`_id`, `at`, and
 * `kind` are generated).
 */
interface CardEventInput {
  cardId: ObjectId;
  from: Status | null;
  to: Status;
  caller: Caller;
  outcome: EventOutcome;
  error: CardEventError | null;
}

/**
 * The caller-supplied fields of a field-edit event (`_id`, `at`, `kind`,
 * `outcome`, and `error` are generated — field edits are audited only after the
 * DB write succeeds, so they are always a success).
 */
interface FieldEditEventInput {
  cardId: ObjectId;
  caller: Caller;
  changes: FieldChange[];
}

/**
 * Appends one status-transition audit event to the `card_events` collection,
 * stamping `_id`, `at`, and `kind`. Called from the card lifecycle choke points
 * (create + transitions).
 * @param db - The database handle.
 * @param event - The status-transition fields to record.
 */
export async function emitCardEvent(
  db: Db,
  event: CardEventInput,
): Promise<void> {
  const doc: StatusTransitionEventDocument = {
    _id: new ObjectId(),
    at: new Date(),
    kind: CardEventKind.StatusTransition,
    ...event,
  };
  await cardEventsCollection(db).insertOne(doc);
}

/**
 * Appends one field-edit audit event to the `card_events` collection, stamping
 * `_id`, `at`, `kind`, and a success outcome. Called after a card's core fields
 * are updated, recording the per-field diff.
 * @param db - The database handle.
 * @param event - The card id, caller, and the changed-field diff.
 */
export async function emitFieldEditEvent(
  db: Db,
  event: FieldEditEventInput,
): Promise<void> {
  const doc: FieldEditEventDocument = {
    _id: new ObjectId(),
    at: new Date(),
    kind: CardEventKind.FieldEdit,
    outcome: EventOutcome.Success,
    error: null,
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
