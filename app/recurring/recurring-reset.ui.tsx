"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { recurringHref } from "./href";

/** Resets a failed task back to due (re-queues it); injected from the server. */
export type ResetToDueAction = (id: string) => Promise<void>;

/**
 * Reset-to-due affordance for a failed task's detail sheet: a button that opens
 * a confirm dialog. Confirming re-queues the task then navigates back to the
 * recurring surface (which closes the sheet and drops `?task=`); a double-submit
 * is guarded. Reset is non-destructive, so the trigger uses the default variant.
 * @param taskId - The failed task to reset.
 * @param resetToDueAction - Server action that performs the reset.
 */
export function RecurringReset({
  taskId,
  resetToDueAction,
}: {
  taskId: string;
  resetToDueAction: ResetToDueAction;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  /** Resets the task once, then closes the sheet by returning to the surface. */
  async function handleReset() {
    if (pending) {
      return;
    }
    setPending(true);
    await resetToDueAction(taskId);
    router.replace(recurringHref());
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button type="button" size="sm" className="justify-self-start" />
        }
      >
        Reset to due
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset this task to due?</AlertDialogTitle>
          <AlertDialogDescription>
            It re-queues for the next run; your fix note is kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            disabled={pending}
            onClick={handleReset}
          >
            Confirm reset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
