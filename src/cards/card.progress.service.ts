import { ObjectId } from "mongodb";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import { progressNoteSchema } from "@/cards/card.schema";
import { reviveStaledCard } from "@/cards/card.staled.service";
import type { Card } from "@/cards/card.type";
import { emitFieldEditEvent } from "@/cards/card-event.service";
import { EditableField } from "@/cards/card-event.type";
import { AppError, ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/**
 * Appends one timestamped progress note to a card's running history (append, not
 * replace — earlier notes are preserved) and bumps `updatedAt`. A blank note is
 * rejected before the write; an unknown id throws {@link ErrorCode.NotFound}.
 * @param id - The card's hex id.
 * @param note - The progress note text (non-empty).
 * @returns The updated client card.
 */
export async function appendProgress(id: string, note: string): Promise<Card> {
  // Validate before the write, wrapping a blank note in a domain error (matches
  // setWorkspace) so a direct caller sees AppError, not a raw ZodError.
  const parsed = progressNoteSchema.safeParse(note);
  if (!parsed.success) {
    throw new AppError(ErrorCode.Validation, "progress note must not be empty");
  }
  const parsedNote = parsed.data;
  const db = await getDb();

  const updated = await findOneAndUpdateZ(
    cardsCollection(db),
    { _id: new ObjectId(id) },
    {
      $set: { updatedAt: new Date() },
      $push: { progress: { at: new Date(), note: parsedNote } },
    },
    cardDocumentSchema,
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  // Audit the append after the write succeeds (same contract as field edits).
  // An append has no prior value, so `from` is null and `to` is the note.
  await emitFieldEditEvent(db, {
    cardId: updated._id,
    caller: Caller.Agent,
    changes: [{ field: EditableField.Progress, from: null, to: parsedNote }],
  });

  // Activity on a parked card pulls it back onto the active board; a no-op when
  // the card is not staled.
  const revived = await reviveStaledCard(updated._id);
  return toClientCard(revived ?? updated);
}
