import { ObjectId } from "mongodb";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import { type Card, RunState, Status } from "@/cards/card.type";
import { emitCardEvent } from "@/cards/card-event.service";
import { EventOutcome } from "@/cards/card-event.type";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/**
 * Atomically claims a todo card for a session. A single
 * `findOneAndUpdate({_id, status: todo}, …)` flips the card to in_progress /
 * running, stamps `pickedAt`, and increments `attempts` — that single-document
 * filter IS the no-double-assignment guarantee. The claim records *that* the
 * card was claimed (a success audit row), not *who* (no owner field). A card
 * that is missing or no longer in Todo matches nothing and yields `null`.
 * @param id - The card's hex id.
 * @returns The claimed client card, or null if it could not be claimed.
 */
export async function claimCard(id: string): Promise<Card | null> {
  const db = await getDb();
  const _id = new ObjectId(id);
  const now = new Date();

  const claimed = await findOneAndUpdateZ(
    cardsCollection(db),
    { _id, status: Status.Todo },
    {
      $set: {
        status: Status.InProgress,
        runState: RunState.Running,
        pickedAt: now,
      },
      $inc: { attempts: 1 },
    },
    cardDocumentSchema,
    { returnDocument: "after" },
  );

  if (!claimed) {
    return null;
  }

  await emitCardEvent(db, {
    cardId: _id,
    from: Status.Todo,
    to: Status.InProgress,
    caller: Caller.Agent,
    outcome: EventOutcome.Success,
    error: null,
  });

  return toClientCard(claimed);
}
