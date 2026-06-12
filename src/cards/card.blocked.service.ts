import { cardDocumentSchema } from "@/cards/card.document.schema";
import { Status } from "@/cards/card.type";
import { emitCardEvent } from "@/cards/card-event.service";
import { EventOutcome } from "@/cards/card-event.type";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/**
 * Advances every Blocked card whose 2h deadline has elapsed to NeedReview,
 * clearing its `blockedUntil`. This is the "persist on read" auto-move: it is
 * invoked on the board read path (initial load + each refresh), since there is
 * no scheduler.
 *
 * Each card is moved with its OWN atomic conditional update
 * (`{_id, status: blocked, blockedUntil <= now}`) rather than via
 * `updateTaskStatus`, so two concurrent board reads cannot double-move or
 * double-audit the same card: the second update matches nothing. Every actual
 * move is audited as a {@link Caller.System} status transition.
 */
export async function reconcileBlockedCards(): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const cards = cardsCollection(db);

  // Narrow to the (small) overdue-blocked subset; the {status} prefix lets the
  // existing status index help. `now` is JS time for the query bound; the write
  // stamps `updatedAt` from the DB clock ($$NOW).
  const overdue = await cards
    .find({ status: Status.Blocked, blockedUntil: { $lte: now } })
    .toArray();

  for (const card of overdue) {
    const moved = await findOneAndUpdateZ(
      cards,
      { _id: card._id, status: Status.Blocked, blockedUntil: { $lte: now } },
      [
        {
          $set: {
            status: Status.NeedReview,
            updatedAt: "$$NOW",
            blockedUntil: null,
          },
        },
      ],
      cardDocumentSchema,
      { returnDocument: "after" },
    );

    // Null means a concurrent reconcile already moved this card — skip the
    // audit so the move is recorded exactly once.
    if (moved) {
      await emitCardEvent(db, {
        cardId: card._id,
        from: Status.Blocked,
        to: Status.NeedReview,
        caller: Caller.System,
        outcome: EventOutcome.Success,
        error: null,
      });
    }
  }
}
