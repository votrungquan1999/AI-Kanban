import { ObjectId } from "mongodb";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import {
  isDuplicateKeyError,
  SESSION_KEY_PREFIX,
  sessionDedupeKey,
} from "@/cards/card.service";
import { type Card, type CardDocument, Status } from "@/cards/card.type";
import { emitFieldEditEvent } from "@/cards/card-event.service";
import { EditableField } from "@/cards/card-event.type";
import { AppError, ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ, findOneZ } from "@/db/find-z";
import { OPEN_STATUSES } from "@/db/indexes";
import { getDb } from "@/db/mongo";

/**
 * Transfers ownership of an existing card to the session now doing the work,
 * re-stamping both `sessionId` and the `dedupeKey` derived from it. Without the
 * key move the card stays keyed to the session that opened it, so the adopting
 * session's own {@link createCard} would not recognise it and would open a
 * second card for the same work — the duplication this exists to stop.
 *
 * The card always takes the session's *base* key: adoption means "this is my
 * card for this work", and a session holds one base card at a time.
 *
 * Guarded, because the partial-unique index cannot police most of this — it
 * only covers OPEN cards, and a finished card is the common adoption target.
 * @param id - The card's hex id.
 * @param sessionId - The handle of the session taking the card over.
 * @returns The updated client card.
 * @throws {AppError} {@link ErrorCode.NotFound} when no such card exists.
 * @throws {AppError} {@link ErrorCode.Validation} when the card is queued
 * (`todo` — use `claimCard`) or carries a non-session `dedupeKey` that
 * adopting would destroy.
 * @throws {AppError} {@link ErrorCode.Duplicate} when this session already
 * holds an open card, or another session adopted this one first.
 */
export async function adoptCard(id: string, sessionId: string): Promise<Card> {
  const db = await getDb();
  const _id = new ObjectId(id);
  const key = sessionDedupeKey(sessionId, 1);

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

  // The partial-unique index only covers OPEN cards, so it cannot stop a
  // re-stamp onto a done/archived one — and a finished card is the common
  // case here. Check the slot ourselves or the write silently produces two
  // cards under one key, with the finished one unable to reopen.
  const holder = await findOneZ(
    cardsCollection(db),
    { dedupeKey: key, status: { $in: OPEN_STATUSES }, _id: { $ne: _id } },
    cardDocumentSchema,
  );
  if (holder) {
    throw new AppError(
      ErrorCode.Duplicate,
      `session ${sessionId} already has an open card (#${holder.number}); resolve that before adopting card ${id}`,
    );
  }

  let updated: CardDocument | null;
  try {
    updated = await findOneAndUpdateZ(
      cardsCollection(db),
      // Filtered on the owner we read above, so a second session racing for
      // the same card matches nothing instead of overwriting the winner. Two
      // "successes" would leave the loser pointing at a card it doesn't own.
      { _id, sessionId: before.sessionId ?? null },
      {
        $set: {
          sessionId,
          dedupeKey: key,
          updatedAt: new Date(),
        },
      },
      cardDocumentSchema,
      { returnDocument: "after" },
    );
  } catch (error) {
    // The partial-unique dedupeKey index rejected the move: this session
    // already holds an open card under that key. Say so — a silently dropped
    // re-stamp leaves the caller believing it owns a card it does not.
    if (isDuplicateKeyError(error)) {
      throw new AppError(
        ErrorCode.Duplicate,
        `session ${sessionId} already has an open card; resolve that before adopting card ${id}`,
      );
    }
    throw error;
  }

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
