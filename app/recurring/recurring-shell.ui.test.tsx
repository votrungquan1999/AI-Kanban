// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  RecurringRunState,
  type RecurringTask,
} from "@/recurring/recurring.type";
import { RecurringShell } from "./recurring-shell.ui";
import { RecurringTaskTile } from "./recurring-task.ui";

/**
 * Builds a client recurring task for tile rendering tests; override per scenario.
 */
function makeTask(partial: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: "0123456789abcdef01234567",
    number: 1,
    title: "Nightly digest",
    instruction: "Summarise the day",
    everyHours: 24,
    enabled: true,
    runState: RecurringRunState.Idle,
    nextDueAt: "2026-01-01T00:00:00.000Z",
    lastRunAt: null,
    lastOutcome: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("Recurring surface", () => {
  it("renders a tile with the task title, schedule label, and run state", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    render(
      <RecurringShell title="Recurring" addRecurringHref="/recurring?new=task">
        <RecurringTaskTile task={makeTask()} now={now} />
      </RecurringShell>,
    );

    expect(screen.getByText("Nightly digest")).toBeInTheDocument();
    expect(screen.getByTestId("tile-schedule")).toHaveTextContent("Daily");
    expect(screen.getByTestId("tile-state")).toHaveTextContent("idle");
  });

  it("surfaces a failed task's run state on the tile", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    render(
      <RecurringShell title="Recurring" addRecurringHref="/recurring?new=task">
        <RecurringTaskTile
          task={makeTask({ runState: RecurringRunState.Failed })}
          now={now}
        />
      </RecurringShell>,
    );

    expect(screen.getByTestId("tile-state")).toHaveTextContent("failed");
  });

  it("links the tile to the task's detail URL", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    render(
      <RecurringShell title="Recurring" addRecurringHref="/recurring?new=task">
        <RecurringTaskTile task={makeTask()} now={now} />
      </RecurringShell>,
    );

    expect(
      screen.getByRole("link", { name: /Nightly digest/ }),
    ).toHaveAttribute("href", "/recurring?task=0123456789abcdef01234567");
  });

  it("shows the add-recurring trigger pointing at the supplied new-task URL", () => {
    render(
      <RecurringShell title="Recurring" addRecurringHref="/recurring?new=task">
        <div />
      </RecurringShell>,
    );

    const trigger = screen.getByRole("button", { name: "New recurring task" });
    expect(trigger.closest("a")).toHaveAttribute("href", "/recurring?new=task");
  });
});
