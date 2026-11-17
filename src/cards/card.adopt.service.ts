import { ObjectId } from "mongodb";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import {
  ADOPTABLE_SESSION_STATUSES,
  SESSION_KEY_PREFIX,
} from "@/cards/card.service";
import { type Card, Status } from "@/cards/card.type";
import { emitFieldEditEvent } from "@/cards/card-event.service";
import { EditableField } from "@/cards/card-event.type";
import { AppError, ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ, findOneZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/**
 * Transfers ownership of an existing card to the session now doing the work,
 * re-stamping its `sessionId`. Without that the adopting session's own
 * {@link createCard} would not recognise the card and would open a second one
 * for the same work — the duplication this exists to stop. Any leftover
 * session `dedupeKey` is cleared: sessions own cards by `sessionId` alone.
 *
 * Refused while the session still holds another unfinished card, so its next
 * {@link createCard} returns this card rather than that one.
 * @param id - The card's hex id.
 * @param sessionId - The handle of the session taking the card over.
 * @returns The updated client card.
 * @throws {AppError} {@link ErrorCode.NotFound} when no such card exists.
 * @throws {AppError} {@link ErrorCode.Validation} when the card is queued
 * (`todo` — use `claimCard`) or carries a non-session `dedupeKey` that
 * adopting would destroy.
 * @throws {AppError} {@link ErrorCode.Duplicate} when this session already
 * holds an unfinished card, or another session adopted this one first.
 */
export async function adoptCard(id: string, sessionId: string): Promise<Card> {
  const db = await getDb();
  const _id = new ObjectId(id);

  const before = await findOneZ(
    cardsCollection(db),
    { _id },
    cardDocumentSchema,
  );
  if (!before) {
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  // A queued card is nobody's yet. Handing it over here would take it out of
  // the queue while skipping claim_card's atomic {status: todo} filter — the
  // single-claim guarantee.
  if (before.status === Status.Todo) {
    throw new AppError(
      ErrorCode.Validation,
      `card ${id} is queued (todo) — claim it with claim_card rather than adopting it`,
    );
  }

  // A key that isn't a session key belongs to whatever produced the card (an
  // importer, an integration) and is how that producer avoids re-creating it.
  // Overwriting it is unrecoverable, so refuse rather than silently clobber.
  if (before.dedupeKey && !before.dedupeKey.startsWith(SESSION_KEY_PREFIX)) {
    throw new AppError(
      ErrorCode.Validation,
      `card ${id} carries an external dedupeKey (${before.dedupeKey}); adopting would destroy it`,
    );
  }

  // Parked cards count: createCard would hand back that card, not this one.
  const holder = await findOneZ(
    cardsCollection(db),
    {
      sessionId,
      status: { $in: ADOPTABLE_SESSION_STATUSES },
      _id: { $ne: _id },
    },
    cardDocumentSchema,
  );
  if (holder) {
    throw new AppError(
      ErrorCode.Duplicate,
      `session ${sessionId} already has an unfinished card (#${holder.number}); resolve that before adopting card ${id}`,
    );
  }

  const updated = await findOneAndUpdateZ(
    cardsCollection(db),
    // Filtered on the owner we read above, so a second session racing for
    // the same card matches nothing instead of overwriting the winner. Two
    // "successes" would leave the loser pointing at a card it doesn't own.
    { _id, sessionId: before.sessionId ?? null },
    { $set: { sessionId, dedupeKey: null, updatedAt: new Date() } },
    cardDocumentSchema,
    { returnDocument: "after" },
  );

  // The card was there a moment ago, so a miss means the owner changed under
  // us — another session adopted it first.
  if (!updated) {
    throw new AppError(
      ErrorCode.Duplicate,
      `card ${id} was adopted by another session first; re-read it before continuing`,
    );
  }

  await emitFieldEditEvent(db, {
    cardId: _id,
    caller: Caller.Agent,
    changes: [
      {
        field: EditableField.SessionId,
        from: before.sessionId ?? null,
        to: sessionId,
      },
    ],
  });

  return toClientCard(updated);
}
