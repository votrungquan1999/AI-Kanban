// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type Card, OriginType, Status } from "@/cards/card.type";
import { ToastProvider } from "@/components/ui/toast";
import { Board } from "./board";
import type { BoardColumnView } from "./board.type";

const noopMove = vi.fn(async () => {});

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

describe("Board", () => {
  it("renders the four columns and their cards", () => {
    const columns: BoardColumnView[] = [
      {
        status: Status.Todo,
        title: "Todo",
        cards: [makeCard({ id: "a", title: "Card A", status: Status.Todo })],
      },
      { status: Status.InProgress, title: "In Progress", cards: [] },
      { status: Status.NeedReview, title: "Need Review", cards: [] },
      {
        status: Status.Done,
        title: "Done",
        cards: [makeCard({ id: "b", title: "Card B", status: Status.Done })],
      },
    ];

    render(
      <ToastProvider>
        <Board columns={columns} moveAction={noopMove} />
      </ToastProvider>,
    );

    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Need Review")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Card A")).toBeInTheDocument();
    expect(screen.getByText("Card B")).toBeInTheDocument();
  });
});
