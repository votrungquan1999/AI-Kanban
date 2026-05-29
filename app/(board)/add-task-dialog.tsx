"use client";

import { useActionState } from "react";
import { AddTaskForm } from "./add-task-form.ui";
import type { AddTaskState } from "./add-task.type";
import { boardHref } from "./href";

const initialState: AddTaskState = {};

interface AddTaskDialogProps {
  open: boolean;
  action: (prev: AddTaskState, formData: FormData) => Promise<AddTaskState>;
}

/**
 * The add-task dialog. Visibility is driven by URL state (`open`); the create
 * action is injected so the dialog stays free of server-only imports.
 * @param open - Whether the dialog is shown.
 * @param action - The form action (validates + creates the card).
 */
export function AddTaskDialog({ open, action }: AddTaskDialogProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  if (!open) {
    return null;
  }

  return (
    <AddTaskForm
      formAction={formAction}
      error={state.error}
      pending={pending}
      cancelHref={boardHref()}
    />
  );
}
