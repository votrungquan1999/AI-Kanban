"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createTaskInputSchema } from "@/cards/card.schema";
import { createTask, updateTaskStatus } from "@/cards/card.service";
import { OriginType, type Status } from "@/cards/card.type";
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
  const parsed = createTaskInputSchema.safeParse({
    title: typeof rawTitle === "string" ? rawTitle : "",
    origin: { type: OriginType.Manual },
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await createTask({
    title: parsed.data.title,
    origin: { type: OriginType.Manual },
  });
  revalidatePath("/");
  redirect("/");
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
