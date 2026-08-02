import { ObjectId } from "mongodb";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import { isDuplicateKeyError, sessionDedupeKey } from "@/cards/card.service";
import type { Card, CardDocument } from "@/cards/card.type";
import { AppError, ErrorCode } from "@/cards/errors";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
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
 * @param id - The card's hex id.
 * @param sessionId - The handle of the session taking the card over.
 * @returns The updated client card.
 * @throws {AppError} {@link ErrorCode.NotFound} when no such card exists.
 */
export async function adoptCard(id: string, sessionId: string): Promise<Card> {
  const db = await getDb();

  let updated: CardDocument | null;
  try {
    updated = await findOneAndUpdateZ(
      cardsCollection(db),
      { _id: new ObjectId(id) },
      {
        $set: {
          sessionId,
          dedupeKey: sessionDedupeKey(sessionId, 1),
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

  if (!updated) {
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  return toClientCard(updated);
}
