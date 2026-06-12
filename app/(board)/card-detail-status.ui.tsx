"use client";

import { type Card, Status } from "@/cards/card.type";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Moves a card to a new status; injected from the server (reuses `moveCard`). */
export type MoveAction = (cardId: string, status: Status) => Promise<void>;

/** Human-readable label for each card status (Archived shown only when viewing). */
export const STATUS_LABELS: Record<Status, string> = {
  [Status.Todo]: "Todo",
  [Status.InProgress]: "In Progress",
  [Status.Blocked]: "Blocked",
  [Status.NeedReview]: "Need Review",
  [Status.Done]: "Done",
  [Status.Archived]: "Archived",
};

/** The columns an operator can move a card between (never the archived state). */
const BOARD_STATUSES: Status[] = [
  Status.Todo,
  Status.InProgress,
  Status.NeedReview,
  Status.Done,
];

/**
 * Lets the operator move the card to another column from the sheet (the
 * phone-friendly alternative to dragging). Offers only the board columns, never
 * the archived state, and skips the action when the current column is re-picked.
 * @param card - The card being moved.
 * @param moveAction - Server action that performs the move.
 */
export function StatusPicker({
  card,
  moveAction,
}: {
  card: Card;
  moveAction: MoveAction;
}) {
  function handleValueChange(next: Status | null) {
    if (next !== null && next !== card.status) {
      void moveAction(card.id, next);
    }
  }

  return (
    <div className="grid gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">
        Move to column
      </span>
      <Select value={card.status} onValueChange={handleValueChange}>
        <SelectTrigger aria-label="Move to column" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BOARD_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
