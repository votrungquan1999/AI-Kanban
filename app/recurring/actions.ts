"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resetToDue, setFixNote } from "@/recurring/recurring.fix.service";
import { createRecurringInputSchema } from "@/recurring/recurring.schema";
import { createRecurringTask } from "@/recurring/recurring.service";
import { type AddRecurringState, ScheduleKind } from "./add-recurring.type";

/** Hours per run for each fixed schedule preset. */
const PRESET_HOURS: Record<string, number> = {
  [ScheduleKind.Hourly]: 1,
  [ScheduleKind.Daily]: 24,
  [ScheduleKind.Weekly]: 168,
};

/**
 * Resolves the form's schedule selection to an interval in hours. Presets map to
 * their fixed values; `custom` reads the numeric `everyHours` field. An unknown
 * or empty custom value yields `NaN`, which the schema then rejects.
 * @param scheduleKind - The selected preset key.
 * @param rawEveryHours - The raw custom-interval field value.
 * @returns The resolved interval in hours (may be NaN for invalid custom input).
 */
function resolveEveryHours(
  scheduleKind: string,
  rawEveryHours: FormDataEntryValue | null,
): number {
  if (scheduleKind === ScheduleKind.Custom) {
    return typeof rawEveryHours === "string"
      ? Number(rawEveryHours)
      : Number.NaN;
  }
  return PRESET_HOURS[scheduleKind] ?? Number.NaN;
}

/**
 * Server Action for the add-recurring form. Maps the schedule preset (or custom
 * value) to `everyHours` server-side, validates against the shared schema; on
 * success creates the recurring task, revalidates the surface, and closes the
 * dialog by redirecting to "/recurring". On failure returns the error.
 * @param _prevState - Previous form state (unused).
 * @param formData - Submitted form data.
 * @returns The next form state (only reached on validation failure).
 */
export async function createRecurringTaskAction(
  _prevState: AddRecurringState,
  formData: FormData,
): Promise<AddRecurringState> {
  const rawTitle = formData.get("title");
  const rawInstruction = formData.get("instruction");
  const rawScheduleKind = formData.get("scheduleKind");
  const scheduleKind =
    typeof rawScheduleKind === "string" ? rawScheduleKind : "";

  const parsed = createRecurringInputSchema.safeParse({
    title: typeof rawTitle === "string" ? rawTitle : "",
    instruction: typeof rawInstruction === "string" ? rawInstruction : "",
    everyHours: resolveEveryHours(scheduleKind, formData.get("everyHours")),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await createRecurringTask({
    title: parsed.data.title,
    instruction: parsed.data.instruction,
    everyHours: parsed.data.everyHours,
  });
  revalidatePath("/recurring");
  redirect("/recurring");
}

/**
 * Server Action: records an operator fix note on a failed task and revalidates
 * the surface so the open detail sheet re-reads the new note. Backs the
 * failed-task fix-note form.
 * @param id - The task's hex id.
 * @param note - The fix note to record (blank clears it).
 */
export async function setFixNoteAction(
  id: string,
  note: string,
): Promise<void> {
  await setFixNote(id, { note });
  revalidatePath("/recurring");
}

/**
 * Server Action: resets a failed task back to due (re-queues it) and
 * revalidates the surface. The detail control navigates back to the surface
 * client-side; this action only mutates + revalidates. Backs the reset control.
 * @param id - The task's hex id.
 */
export async function resetToDueAction(id: string): Promise<void> {
  await resetToDue(id);
  revalidatePath("/recurring");
}
