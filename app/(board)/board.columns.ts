import { type Card, Status } from "@/cards/card.type";
import type { BoardColumnView } from "./board.type";

interface ColumnDef {
  status: Status;
  title: string;
}

/** Fixed column order shown on the board. */
const COLUMN_DEFS: ColumnDef[] = [
  { status: Status.Todo, title: "Todo" },
  { status: Status.InProgress, title: "In Progress" },
  { status: Status.Blocked, title: "Blocked" },
  { status: Status.NeedReview, title: "Need Review" },
  { status: Status.Done, title: "Done" },
];

/**
 * Groups a flat list of cards into the five ordered board columns
 * (Todo · In Progress · Blocked · Need Review · Done).
 * @param cards - All cards to display.
 * @returns One {@link BoardColumnView} per column, in display order.
 */
export function groupIntoColumns(cards: Card[]): BoardColumnView[] {
  return COLUMN_DEFS.map((def) => ({
    status: def.status,
    title: def.title,
    cards: cards.filter((card) => card.status === def.status),
  }));
}
