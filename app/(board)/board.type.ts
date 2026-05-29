import type { Card, Status } from "@/cards/card.type";

/** A single board column with its cards, ready for rendering. */
export interface BoardColumnView {
  status: Status;
  title: string;
  cards: Card[];
}
