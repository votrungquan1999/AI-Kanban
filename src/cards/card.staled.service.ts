import type { ObjectId } from "mongodb";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { type CardDocument, Status } from "@/cards/card.type";
import { emitCardEvent } from "@/cards/card-event.service";
import { EventOutcome } from "@/cards/card-event.type";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/** Idle time an in-progress card may sit before it is parked as stale. */
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/**
 * Parks every in-progress card that has been idle past the 3-hour threshold in
 * the Staled lane. Like {@link reconcileBlockedCards}, this is the "persist on
 * read" auto-move invoked on the board read path (there is no scheduler).
 * Staleness keys directly off `updatedAt` age — no stored deadline.
 *
 * Each card is moved with its OWN atomic conditional update
 * (`{_id, status: in_progress, updatedAt <= threshold}`), so two concurrent
 * board reads cannot double-move or double-audit the same card: the second
 * update matches nothing. Moving to Staled removes the card from the
 * `{status: in_progress}` set, so it cannot loop. Every actual move is audited
 * as a {@link Caller.System} status transition.
 */
export async function reconcileStaledCards(): Promise<void> {
  const db = await getDb();
  const threshold = new Date(Date.now() - THREE_HOURS_MS);
  const cards = cardsCollection(db);

  // Narrow to the (small) idle in-progress subset; the {status} prefix lets the
  // existing status index help. `threshold` is JS time for the query bound; the
  // write stamps `updatedAt` from the DB clock ($$NOW).
  const stale = await cards
    .find({ status: Status.InProgress, updatedAt: { $lte: threshold } })
    .toArray();

  for (const card of stale) {
    const moved = await findOneAndUpdateZ(
      cards,
      {
        _id: card._id,
        status: Status.InProgress,
        updatedAt: { $lte: threshold },
      },
      [{ $set: { status: Status.Staled, updatedAt: "$$NOW" } }],
      cardDocumentSchema,
      { returnDocument: "after" },
    );

    // Null means a concurrent reconcile already parked this card — skip the
    // audit so the move is recorded exactly once.
    if (moved) {
      await emitCardEvent(db, {
        cardId: card._id,
        from: Status.InProgress,
        to: Status.Staled,
        caller: Caller.System,
        outcome: EventOutcome.Success,
        error: null,
      });
    }
  }
}

/**
 * Auto-revives a Staled card back to In-Progress when a content update touches
 * it — the inverse of {@link reconcileStaledCards}. Called from the content
 * write paths (progress, decision, edit, mark-outdated, workspace) AFTER their
 * own write lands, so any activity on a parked card pulls it back onto the
 * active board. Status-change ops are excluded (they own the lane explicitly).
 *
 * The flip is one atomic conditional update (`{_id, status: staled}`), so it is
 * a no-op when the card is not staled (returns null) and cannot race a
 * concurrent reconcile into a double-move. Every actual revive is audited as a
 * {@link Caller.System} Staled -> InProgress transition, mirroring the park.
 * @param cardId - The card's id.
 * @returns The revived card document, or null when the card was not staled.
 */
export async function reviveStaledCard(
  cardId: ObjectId,
): Promise<CardDocument | null> {
  const db = await getDb();
  const cards = cardsCollection(db);

  const moved = await findOneAndUpdateZ(
    cards,
    { _id: cardId, status: Status.Staled },
    [{ $set: { status: Status.InProgress, updatedAt: "$$NOW" } }],
    cardDocumentSchema,
    { returnDocument: "after" },
  );

  // Null means the card was not staled (or a concurrent op already moved it) —
  // nothing to revive and nothing to audit.
  if (moved) {
    await emitCardEvent(db, {
      cardId,
      from: Status.Staled,
      to: Status.InProgress,
      caller: Caller.System,
      outcome: EventOutcome.Success,
      error: null,
    });
  }

  return moved;
}
