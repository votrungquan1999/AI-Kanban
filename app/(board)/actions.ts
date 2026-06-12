"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteTask, updateTask } from "@/cards/card.edit.service";
import {
  createTaskInputSchema,
  type UpdateTaskInput,
} from "@/cards/card.schema";
import { createTask, updateTaskStatus } from "@/cards/card.service";
import { OriginType, Status } from "@/cards/card.type";
import { Caller } from "@/cards/transition-policy";
import type { AddTaskState } from "./add-task.type";

/**
 * Server Action for the add-task form. Validates the title against the shared
 * Zod schema; on success creates a manual todo card, revalidates the board,
 * and closes the dialog by redirecting to "/". On failure returns the error.
 * @param _prevState - Previous form state (unused).
 * @param formData - Submitted form data.
 * @returns The next form state (only reached on validation failure).
 */
export async function createTaskAction(
  _prevState: AddTaskState,
  formData: FormData,
): Promise<AddTaskState> {
  const rawTitle = formData.get("title");
  const rawPriority = formData.get("priority");
  const parsed = createTaskInputSchema.safeParse({
    title: typeof rawTitle === "string" ? rawTitle : "",
    origin: { type: OriginType.Manual },
    priority: typeof rawPriority === "string" ? Number(rawPriority) : undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await createTask({
    title: parsed.data.title,
    origin: { type: OriginType.Manual },
    priority: parsed.data.priority,
  });
  revalidatePath("/");
  redirect("/");
}

/**
 * Server Action: edits a card's core fields (title / description / priority)
 * and revalidates the board so the open detail sheet re-reads the new values.
 * Backs the sheet's inline edit form.
 * @param cardId - The card's hex id.
 * @param patch - The subset of editable fields to change.
 */
export async function updateTaskAction(
  cardId: string,
  patch: UpdateTaskInput,
): Promise<void> {
  await updateTask(cardId, patch);
  revalidatePath("/");
}

/**
 * Server Action: archives (soft-deletes) a card and revalidates the board so it
 * drops out of the default view. Backs the sheet's confirm-to-archive control.
 * @param cardId - The card's hex id.
 */
export async function deleteTaskAction(cardId: string): Promise<void> {
  await deleteTask(cardId);
  revalidatePath("/");
}

/**
 * Server Action: moves a card to a new status (human UI override) and
 * revalidates the board. Backs the board's drag-to-move.
 * @param cardId - The card's hex id.
 * @param toStatus - The target status/column.
 */
export async function moveCard(
  cardId: string,
  toStatus: Status,
): Promise<void> {
  await updateTaskStatus(cardId, toStatus, { caller: Caller.Ui });
  revalidatePath("/");
}

/**
 * Server Action: moves a card into the Blocked column (human UI override),
 * which starts its 2h auto-move countdown, then revalidates the board. Backs
 * the tile + detail-sheet "Block" quick action.
 * @param cardId - The card's hex id.
 */
export async function blockCard(cardId: string): Promise<void> {
  await updateTaskStatus(cardId, Status.Blocked, { caller: Caller.Ui });
  revalidatePath("/");
}

/**
 * Server Action: keeps an already-blocked card blocked, restarting its 2h
 * countdown (re-enters Blocked), then revalidates the board. Backs the
 * "Still Blocked" quick action.
 * @param cardId - The card's hex id.
 */
export async function stillBlockedCard(cardId: string): Promise<void> {
  await updateTaskStatus(cardId, Status.Blocked, { caller: Caller.Ui });
  revalidatePath("/");
}
