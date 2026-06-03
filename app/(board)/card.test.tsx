// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type Card, OriginType, Status } from "@/cards/card.type";
import { ToastProvider } from "@/components/ui/toast";
import { CardTile } from "./card.ui";

/**
 * Builds a client card for tile rendering tests; override fields per scenario.
 */
function makeCard(partial: Partial<Card> = {}): Card {
  return {
    id: "0123456789abcdef01234567",
    number: 1,
    title: "Card title",
    status: Status.Todo,
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

/**
 * Renders a tile inside the toast provider the copy control depends on.
 */
function renderTile(card: Card, now?: Date) {
  return render(
    <ToastProvider>
      <CardTile card={card} now={now} />
    </ToastProvider>,
  );
}

describe("CardTile", () => {
  it("shows a description preview when the card has one", () => {
    renderTile(makeCard({ description: "Wire up the dispatch copy control" }));

    expect(screen.getByTestId("tile-description")).toHaveTextContent(
      "Wire up the dispatch copy control",
    );
  });

  it("shows the primary repo·branch with an overflow count for extra repos", () => {
    renderTile(
      makeCard({
        repos: [
          { repo: "ai-kanban", branch: "feat/x", worktreePath: "/w/1" },
          { repo: "infra", branch: "feat/y", worktreePath: "/w/2" },
        ],
      }),
    );

    expect(screen.getByTestId("tile-repo")).toHaveTextContent(
      "ai-kanban·feat/x +1",
    );
  });

  it("shows a recurring marker for a recurring card", () => {
    renderTile(
      makeCard({
        origin: {
          type: OriginType.Recurring,
          defId: "0123456789abcdef01234567",
        },
      }),
    );

    expect(screen.getByLabelText("Recurring")).toBeInTheDocument();
  });

  it("shows the relative age from pickedAt when present", () => {
    const now = new Date("2026-01-03T00:00:00.000Z");
    renderTile(
      makeCard({
        pickedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2025-12-01T00:00:00.000Z",
      }),
      now,
    );

    // pickedAt (2 days ago) wins over the month-old createdAt
    expect(screen.getByTestId("tile-age")).toHaveTextContent("2 days ago");
  });

  it("renders a calm empty tile: number, priority, title — no enrichment chips", () => {
    renderTile(makeCard());

    expect(screen.getByText("Card title")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("P0")).toBeInTheDocument();

    expect(screen.queryByTestId("tile-description")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tile-repo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tile-recurring")).not.toBeInTheDocument();
  });
});
