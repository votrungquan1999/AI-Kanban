"use client";

import { useToast } from "@/components/ui/toast";

/**
 * Generic clipboard-copy primitive used by the tile (dispatch command / id) and
 * the detail sheet (individual field values). Writes the given text to the
 * clipboard and, on success, shows a confirmation toast.
 * @returns A `copy(text, confirmation?)` action bound to the toast manager.
 */
export function useCopyDispatch() {
  const toast = useToast();

  /**
   * Copy `text` to the clipboard, then toast `confirmation` on success.
   * @param text - The exact string to place on the clipboard.
   * @param confirmation - Toast title shown after a successful copy.
   */
  async function copy(text: string, confirmation = "Copied"): Promise<void> {
    await navigator.clipboard.writeText(text);
    toast.add({ title: confirmation });
  }

  return { copy };
}
