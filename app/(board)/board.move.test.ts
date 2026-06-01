import { describe, expect, it } from "vitest";
import { type Card, OriginType, Status } from "@/cards/card.type";
import { applyOptimisticMove } from "./board.move";
import type { BoardColumnView } from "./board.type";

function makeCard(partial: Pick<Card, "id" | "title" | "status">): Card {
  return {
    number: 1,
    priority: 0,
    origin: { type: OriginType.Manual },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pickedAt: null,
    finishedAt: null,
    workspacePath: null,
    repos: [],
    ...partial,
  };
}

describe("applyOptimisticMove", () => {
  it("moves a card to the target column and updates its status", () => {
    const columns: BoardColumnView[] = [
      {
        status: Status.Todo,
        title: "Todo",
        cards: [makeCard({ id: "a", title: "Card A", status: Status.Todo })],
      },
      { status: Status.InProgress, title: "In Progress", cards: [] },
    ];

    const next = applyOptimisticMove(columns, {
      cardId: "a",
      toStatus: Status.InProgress,
    });

    const todo = next.find((column) => column.status === Status.Todo);
    const inProgress = next.find(
      (column) => column.status === Status.InProgress,
    );

    expect(todo?.cards).toHaveLength(0);
    expect(inProgress?.cards).toHaveLength(1);
    expect(inProgress?.cards[0].id).toBe("a");
    expect(inProgress?.cards[0].status).toBe(Status.InProgress);
  });
});
