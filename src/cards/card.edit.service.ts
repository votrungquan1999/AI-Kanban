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

/** Options for {@link updateTask}. */
interface UpdateTaskOptions {
  caller?: Caller;
}

/**
 * Stringifies a card field value for the audit diff, or `null` when the field
 * is absent (e.g. a card with no description).
 * @param value - The raw field value (string, number, or undefined).
 */
function toAuditValue(value: string | number | undefined): string | null {
  return value === undefined ? null : String(value);
}

/**
 * Stringifies a tag list for the audit diff: sorted + joined so the trail is
 * order-independent, or `null` when absent (never set) — a real "clear all
 * tags" audits as `""`, distinguishable from `null`.
 * @param value - The raw tag list, or undefined when absent.
 */
function toAuditArrayValue(value: string[] | undefined): string | null {
  return value === undefined ? null : [...value].sort().join(", ");
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
  if (patch.nextAction !== undefined) {
    // Blank (post-trim) clears the field (D8), mirroring description —
    // clearing an already-absent nextAction is a no-op.
    const nextValue = patch.nextAction === "" ? undefined : patch.nextAction;
    const beforeValue = before.nextAction ?? undefined;
    if (nextValue !== beforeValue) {
      changes.push({
        field: EditableField.NextAction,
        from: toAuditValue(beforeValue),
        to: toAuditValue(nextValue),
      });
    }
  }
  if (patch.tags !== undefined) {
    // Tags are a set everywhere else (e.g. list_cards' ANY-of filter) —
    // reordering the same tags is not a change (D13).
    const beforeTags = new Set(before.tags ?? []);
    const patchTags = new Set(patch.tags);
    const tagsChanged =
      beforeTags.size !== patchTags.size ||
      [...beforeTags].some((tag) => !patchTags.has(tag));
    if (tagsChanged) {
      changes.push({
        field: EditableField.Tags,
        from: toAuditArrayValue(before.tags),
        to: toAuditArrayValue(patch.tags),
      });
    }
  }

  return changes;
}

/**
 * Edits a card's core fields (title / description / priority / nextAction /
 * tags) — only patch-present fields are written, and `updatedAt`/the
 * field-edit audit event fire ONLY when something actually changed (D7).
 * `caller` defaults to UI; an agent entry point passes {@link Caller.Agent}
 * (D1) so the audit trail shows who edited. Malformed patch throws
 * {@link ErrorCode.Validation}; unknown id throws {@link ErrorCode.NotFound}.
 * @param id - The card's hex id.
 * @param patch - The subset of editable fields to change.
 * @param options - Caller designation (defaults to the UI caller).
 * @returns The updated client card.
 */
export async function updateTask(
  id: string,
  patch: UpdateTaskInput,
  options: UpdateTaskOptions = {},
): Promise<Card> {
  const caller = options.caller ?? Caller.Ui;
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

  // A blank description/nextAction clears that field via $unset (reads back
  // as absent) rather than storing an empty string. Each is handled
  // independently, so clearing both never collides and neither field is ever
  // both $set and $unset.
  const {
    description: patchDescription,
    nextAction: patchNextAction,
    ...rest
  } = parsed.data;
  const clearsDescription = patchDescription === "";
  const clearsNextAction = patchNextAction === "";
  const unsetFields: Partial<Record<"description" | "nextAction", "">> = {
    ...(clearsDescription ? { description: "" } : {}),
    ...(clearsNextAction ? { nextAction: "" } : {}),
  };
  const update: UpdateFilter<CardDocument> = {
    $set: {
      ...rest,
      ...(patchDescription !== undefined && !clearsDescription
        ? { description: patchDescription }
        : {}),
      ...(patchNextAction !== undefined && !clearsNextAction
        ? { nextAction: patchNextAction }
        : {}),
      // Only bump updatedAt on an actual change (D7) — a no-op patch must not
      // float the card to the top of a recency-sorted survey.
      ...(changes.length > 0 ? { updatedAt: new Date() } : {}),
    },
    ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
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
      caller,
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
