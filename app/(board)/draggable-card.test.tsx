// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type Card, OriginType, Status } from "@/cards/card.type";
import { ToastProvider } from "@/components/ui/toast";
import { DraggableCard } from "./draggable-card.ui";

/**
 * Builds a minimal client card for rendering tests.
 */
function makeCard(partial: Pick<Card, "id" | "title" | "status">): Card {
  return {
    number: 1,
    priority: 0,
    origin: { type: OriginType.Manual },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pickedAt: null,
    finishedAt: null,
    blockedUntil: null,
    blockInterval: null,
    workspacePath: null,
    repos: [],
    tags: [],
    sessionId: null,
    nextAction: null,
    progress: [],
    decisions: [],
    ...partial,
  };
}

describe("DraggableCard", () => {
  it("puts the drag activator on the grip handle, not the card body", () => {
    render(
      <ToastProvider>
        <DndContext>
          <DraggableCard
            card={makeCard({ id: "a", title: "Card A", status: Status.Todo })}
          />
        </DndContext>
      </ToastProvider>,
    );

    // The grip is a labelled button carrying dnd-kit's draggable affordance
    const grip = screen.getByRole("button", { name: /drag/i });
    expect(grip).toHaveAttribute("aria-roledescription", "draggable");

    // The card body (its title) is NOT inside the draggable activator
    const title = screen.getByText("Card A");
    expect(title.closest('[aria-roledescription="draggable"]')).toBeNull();
  });

  it("makes the card body a link to the card detail URL", () => {
    render(
      <ToastProvider>
        <DndContext>
          <DraggableCard
            card={makeCard({ id: "abc", title: "Card A", status: Status.Todo })}
          />
        </DndContext>
      </ToastProvider>,
    );

    // Tapping the body navigates to that card's detail URL (?card=<id>)
    const link = screen.getByRole("link", { name: /card a/i });
    expect(link).toHaveAttribute("href", "/?card=abc");
  });
});
