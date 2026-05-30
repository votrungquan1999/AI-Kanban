"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AddTaskState } from "./add-task.type";
import { AddTaskForm } from "./add-task-form.ui";
import { boardHref } from "./href";

const initialState: AddTaskState = {};

interface AddTaskDialogProps {
  open: boolean;
  action: (prev: AddTaskState, formData: FormData) => Promise<AddTaskState>;
}

/**
 * The add-task dialog. Visibility is driven by URL state (`open`); closing it
 * navigates back to the board (stripping `?new=task`). The create action is
 * injected so the dialog stays free of server-only imports.
 * @param open - Whether the dialog is shown.
 * @param action - The form action (validates + creates the card).
 */
export function AddTaskDialog({ open, action }: AddTaskDialogProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      router.replace(boardHref());
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <AddTaskForm
          formAction={formAction}
          error={state.error}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  );
}
