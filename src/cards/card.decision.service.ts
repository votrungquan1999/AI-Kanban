import { ObjectId } from "mongodb";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import { decisionTextSchema } from "@/cards/card.schema";
import type { Card } from "@/cards/card.type";
import { DecisionStatus } from "@/cards/card.type";
import { emitFieldEditEvent } from "@/cards/card-event.service";
import { EditableField } from "@/cards/card-event.type";
import { AppError, ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/**
 * Appends one timestamped decision to a card's durable decision log (append,
 * not replace — earlier decisions are preserved) and bumps `updatedAt`. An
 * unknown id throws {@link ErrorCode.NotFound}.
 * @param id - The card's hex id.
 * @param decision - The decision text.
 * @param why - An optional short reason.
 * @returns The updated client card.
 */
export async function appendDecision(
  id: string,
  decision: string,
  why?: string,
): Promise<Card> {
  // Validate before the write, wrapping a blank decision in a domain error
  // (matches appendProgress) so a direct caller sees AppError, not ZodError.
  const parsed = decisionTextSchema.safeParse(decision);
  if (!parsed.success) {
    throw new AppError(ErrorCode.Validation, "decision must not be empty");
  }
  const parsedDecision = parsed.data;
  // Blank/whitespace-only why collapses to absent (D10 R4) — mirrors the
  // nextAction blank-clears convention.
  const trimmedWhy = why?.trim();
  const normalizedWhy = trimmedWhy ? trimmedWhy : undefined;
  const db = await getDb();

  const updated = await findOneAndUpdateZ(
    cardsCollection(db),
    { _id: new ObjectId(id) },
    {
      $set: { updatedAt: new Date() },
      $push: {
        decisions: {
          at: new Date(),
          decision: parsedDecision,
          // Conditional spread — never write a bare `why: undefined` into the
          // push. `why` is `.optional()` (never `.nullable()`), so a driver
          // that serializes `undefined` as BSON null would throw SchemaDrift
          // on the very next read of this card.
          ...(normalizedWhy !== undefined ? { why: normalizedWhy } : {}),
          status: DecisionStatus.Active,
        },
      },
    },
    cardDocumentSchema,
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  // Audit the append after the write succeeds (same contract as
  // appendProgress). An append has no prior value, so `from` is null.
  await emitFieldEditEvent(db, {
    cardId: updated._id,
    caller: Caller.Agent,
    changes: [
      { field: EditableField.Decision, from: null, to: parsedDecision },
    ],
  });

  return toClientCard(updated);
}

/**
 * Marks one decision in a card's decision log as outdated, optionally noting
 * which later decision replaced it. Immutable: only `status` and
 * `supersededByIndex` change — the original `decision`/`why` text is never
 * rewritten. The filter requires `decisions.<index>` to exist, so a bad index
 * (out of range, or a card with no `decisions[<index>]`) is indistinguishable
 * from a missing card and throws {@link ErrorCode.NotFound} either way.
 * Re-marking an already-outdated entry is an allowed no-op-style update, not
 * an error (D5) — the filter does not condition on current status.
 * @param id - The card's hex id.
 * @param index - The zero-based index into `decisions[]` to mark outdated.
 * @param supersededByIndex - The index of the decision that replaced it.
 * @returns The updated client card.
 */
export async function markDecisionOutdated(
  id: string,
  index: number,
  supersededByIndex?: number,
): Promise<Card> {
  // A decision cannot supersede itself (D10 R12) — incoherent.
  if (supersededByIndex === index) {
    throw new AppError(
      ErrorCode.Validation,
      "a decision cannot be superseded by itself",
    );
  }
  const db = await getDb();

  const updated = await findOneAndUpdateZ(
    cardsCollection(db),
    { _id: new ObjectId(id), [`decisions.${index}`]: { $exists: true } },
    {
      $set: {
        [`decisions.${index}.status`]: DecisionStatus.Outdated,
        updatedAt: new Date(),
        // Conditional spread — never write a bare `undefined` into $set.
        // `supersededByIndex` is `.optional()` (never `.nullable()`), so a
        // driver that serializes `undefined` as BSON null would throw
        // SchemaDrift on the very next read of this card.
        ...(supersededByIndex !== undefined
          ? { [`decisions.${index}.supersededByIndex`]: supersededByIndex }
          : {}),
      },
    },
    cardDocumentSchema,
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new AppError(
      ErrorCode.NotFound,
      `card ${id} not found or has no decision at index ${index}`,
    );
  }

  await emitFieldEditEvent(db, {
    cardId: updated._id,
    caller: Caller.Agent,
    changes: [
      { field: EditableField.Decision, from: "active", to: "outdated" },
    ],
  });

  return toClientCard(updated);
}
