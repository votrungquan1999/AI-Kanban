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
import { boardHref } from "./href";

/** Archives (soft-deletes) a card by id; injected from the server. */
export type DeleteAction = (cardId: string) => Promise<void>;

/**
 * Archive affordance for the detail sheet: a destructive button that opens a
 * confirm dialog. Confirming archives the card then navigates back to the board
 * (which both closes the sheet and drops `?card=`); a double-submit is guarded.
 * Cancelling does nothing. No toast — the card simply leaves the board.
 * @param cardId - The card to archive.
 * @param deleteAction - Server action that performs the archive.
 */
export function ArchiveControl({
  cardId,
  deleteAction,
}: {
  cardId: string;
  deleteAction: DeleteAction;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  /** Archives the card once, then closes the sheet by returning to the board. */
  async function handleArchive() {
    if (pending) {
      return;
    }
    setPending(true);
    await deleteAction(cardId);
    router.replace(boardHref());
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="justify-self-start"
          />
        }
      >
        Archive
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this card?</AlertDialogTitle>
          <AlertDialogDescription>
            It leaves the board but stays recoverable.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={handleArchive}
          >
            Archive card
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
