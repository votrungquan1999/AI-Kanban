"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AddRecurringState } from "./add-recurring.type";
import { AddRecurringForm } from "./add-recurring-form.ui";
import { recurringHref } from "./href";

const initialState: AddRecurringState = {};

interface AddRecurringDialogProps {
  open: boolean;
  action: (
    prev: AddRecurringState,
    formData: FormData,
  ) => Promise<AddRecurringState>;
}

/**
 * The add-recurring dialog. Visibility is driven by URL state (`open`); closing
 * it navigates back to the recurring surface (stripping `?new=task`). The create
 * action is injected so the dialog stays free of server-only imports.
 * @param open - Whether the dialog is shown.
 * @param action - The form action (validates + creates the recurring task).
 */
export function AddRecurringDialog({ open, action }: AddRecurringDialogProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      router.replace(recurringHref());
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New recurring task</DialogTitle>
        </DialogHeader>
        <AddRecurringForm
          formAction={formAction}
          error={state.error}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  );
}
