import { ObjectId, type UpdateFilter } from "mongodb";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import {
  type ParsedUpdateTaskInput,
  type UpdateTaskInput,
  updateTaskInputSchema,
} from "@/cards/card.schema";
import { updateTaskStatus } from "@/cards/card.service";
import { type Card, type CardDocument, Status } from "@/cards/card.type";
import { emitFieldEditEvent } from "@/cards/card-event.service";
import { EditableField, type FieldChange } from "@/cards/card-event.type";
import { AppError, ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ, findOneZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/**
 * Stringifies a card field value for the audit diff, or `null` when the field
 * is absent (e.g. a card with no description).
 * @param value - The raw field value (string, number, or undefined).
 */
function toAuditValue(value: string | number | undefined): string | null {
  return value === undefined ? null : String(value);
}

/**
 * Computes the per-field diff between the stored card and a validated patch.
 * Only fields present in the patch whose value actually differs are included,
 * so a no-op assignment leaves no audit trail.
 * @param before - The card document prior to the edit.
 * @param patch - The validated, parsed edit input.
 * @returns The list of changed fields with their old/new values.
 */
function diffFields(
  before: CardDocument,
  patch: ParsedUpdateTaskInput,
): FieldChange[] {
  const changes: FieldChange[] = [];

  if (patch.title !== undefined && patch.title !== before.title) {
    changes.push({
      field: EditableField.Title,
      from: toAuditValue(before.title),
      to: toAuditValue(patch.title),
    });
  }
  if (patch.description !== undefined) {
    // A blank description clears the field, so it normalizes to "absent" for
    // both the comparison and the audit value — clearing an already-absent
    // description is a no-op and leaves no trail.
    const nextDescription =
      patch.description === "" ? undefined : patch.description;
    if (nextDescription !== before.description) {
      changes.push({
        field: EditableField.Description,
        from: toAuditValue(before.description),
        to: toAuditValue(nextDescription),
      });
    }
  }
  if (patch.priority !== undefined && patch.priority !== before.priority) {
    changes.push({
      field: EditableField.Priority,
      from: toAuditValue(before.priority),
      to: toAuditValue(patch.priority),
    });
  }

  return changes;
}

/**
 * Edits a card's core fields (title / description / priority). Only the fields
 * present in the patch are written; `updatedAt` is always bumped. A field-edit
 * audit event is emitted capturing the diff — but only when something actually
 * changed (a no-op or empty patch bumps `updatedAt` and emits nothing). A
 * malformed patch throws {@link ErrorCode.Validation} and leaves the card
 * untouched; an unknown id throws {@link ErrorCode.NotFound}.
 * @param id - The card's hex id.
 * @param patch - The subset of editable fields to change.
 * @returns The updated client card.
 */
export async function updateTask(
  id: string,
  patch: UpdateTaskInput,
): Promise<Card> {
  const parsed = updateTaskInputSchema.safeParse(patch);
  if (!parsed.success) {
    throw new AppError(
      ErrorCode.Validation,
      `invalid card edit: ${parsed.error.message}`,
    );
  }

  const db = await getDb();
  const before = await findOneZ(
    cardsCollection(db),
    { _id: new ObjectId(id) },
    cardDocumentSchema,
  );
  if (!before) {
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  const changes = diffFields(before, parsed.data);

  // A blank description clears the field via $unset (reads back as absent, like
  // a card that never had one) rather than storing an empty string. The same
  // field is never both $set and $unset.
  const { description: patchDescription, ...rest } = parsed.data;
  const clearsDescription = patchDescription === "";
  const update: UpdateFilter<CardDocument> = {
    $set: {
      ...rest,
      ...(patchDescription !== undefined && !clearsDescription
        ? { description: patchDescription }
        : {}),
      updatedAt: new Date(),
    },
    ...(clearsDescription ? { $unset: { description: "" } } : {}),
  };

  const updated = await findOneAndUpdateZ(
    cardsCollection(db),
    { _id: new ObjectId(id) },
    update,
    cardDocumentSchema,
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  if (changes.length > 0) {
    await emitFieldEditEvent(db, {
      cardId: new ObjectId(id),
      caller: Caller.Ui,
      changes,
    });
  }

  return toClientCard(updated);
}

/**
 * Soft-deletes a card by moving it to {@link Status.Archived} — it leaves the
 * board's default view but stays in the collection (recoverable, audit intact).
 * Reuses {@link updateTaskStatus} as the UI caller (any→any), so the move is
 * recorded as a transition audit event. An unknown id throws
 * {@link ErrorCode.NotFound}.
 * @param id - The card's hex id.
 * @returns The archived client card.
 */
export async function deleteTask(id: string): Promise<Card> {
  return updateTaskStatus(id, Status.Archived, { caller: Caller.Ui });
}
