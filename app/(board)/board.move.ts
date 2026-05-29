import type { Card, Status } from "@/cards/card.type";
import type { BoardColumnView } from "./board.type";

/** A request to move a card to a different column/status. */
export interface MoveAction {
  cardId: string;
  toStatus: Status;
}

/**
 * Returns a new column array with the given card removed from its current
 * column and appended to the target column with its status updated. If the
 * card is not found, the input columns are returned unchanged.
 * @param columns - Current board columns.
 * @param move - The card id and target status.
 * @returns The updated columns (pure; inputs are not mutated).
 */
export function applyOptimisticMove(
  columns: BoardColumnView[],
  move: MoveAction,
): BoardColumnView[] {
  let movedCard: Card | undefined;

  const withoutCard = columns.map((column) => ({
    ...column,
    cards: column.cards.filter((card) => {
      if (card.id === move.cardId) {
        movedCard = card;
        return false;
      }
      return true;
    }),
  }));

  if (!movedCard) {
    return columns;
  }

  const relocated: Card = { ...movedCard, status: move.toStatus };

  return withoutCard.map((column) =>
    column.status === move.toStatus
      ? { ...column, cards: [...column.cards, relocated] }
      : column,
  );
}
