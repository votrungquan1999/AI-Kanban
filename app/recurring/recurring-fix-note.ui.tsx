"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Records an operator fix note on a failed task; injected from the server. */
export type SetFixNoteAction = (id: string, note: string) => Promise<void>;

/**
 * Inline fix-note form for a failed task, shown in the detail sheet. Submitting
 * (a React form action, so it runs in a transition) calls the injected action
 * with the typed note. A blank note is allowed (the service clears the field).
 * @param taskId - The failed task's hex id.
 * @param fixNote - The current fix note (seeds the textarea default).
 * @param setFixNoteAction - Server action that persists the note.
 */
export function RecurringFixNote({
  taskId,
  fixNote,
  setFixNoteAction,
}: {
  taskId: string;
  fixNote?: string;
  setFixNoteAction: SetFixNoteAction;
}) {
  /**
   * Collects the note and persists it via the injected action. Run as a form
   * action so React wraps it in a transition.
   * @param data - The submitted form data.
   */
  async function handleAction(data: FormData) {
    await setFixNoteAction(taskId, String(data.get("note")));
  }

  return (
    <form action={handleAction} className="grid gap-1.5">
      <Label htmlFor="fix-note">Fix note</Label>
      <Textarea id="fix-note" name="note" defaultValue={fixNote ?? ""} />
      <Button type="submit" size="sm" className="justify-self-start">
        Save fix note
      </Button>
    </form>
  );
}
