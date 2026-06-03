"use client";

import { ChevronDownIcon, CopyIcon } from "lucide-react";
import type { PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCopyDispatch } from "./copy-dispatch.state";

/**
 * Builds the ready-to-run dispatch command for a card id.
 * @param cardId - The card's 24-character hex id.
 */
function dispatchCommand(cardId: string): string {
  return `/ai-kanban-work-card ${cardId}`;
}

/**
 * Tile copy control. The primary button is one-tap "copy the dispatch command";
 * the adjacent caret opens a menu to choose between the command (default) and
 * the bare card id. Pointer-down/click are stopped from bubbling so a press
 * never starts a card drag or, later, opens the detail sheet.
 * @param cardId - The card's 24-character hex id.
 */
export function CopyDispatch({ cardId }: { cardId: string }) {
  const { copy } = useCopyDispatch();
  const command = dispatchCommand(cardId);

  function stopDrag(event: PointerEvent) {
    event.stopPropagation();
  }

  return (
    <div className="grid grid-flow-col items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Copy dispatch command"
        onPointerDown={stopDrag}
        onClick={(event) => {
          event.stopPropagation();
          void copy(command, "Copied dispatch command");
        }}
      >
        <CopyIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          onPointerDown={stopDrag}
          onClick={(event) => event.stopPropagation()}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Copy options"
            />
          }
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={() => void copy(command, "Copied dispatch command")}
          >
            Copy command
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void copy(cardId, "Copied card id")}>
            Copy id
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
