// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddTaskDialog } from "./add-task-dialog";
import type { AddTaskState } from "./add-task.type";

describe("AddTaskDialog", () => {
  it("renders nothing when closed", () => {
    const action = vi.fn(async (): Promise<AddTaskState> => ({}));

    render(<AddTaskDialog open={false} action={action} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits the form and shows the action's validation error", async () => {
    const action = vi.fn(
      async (): Promise<AddTaskState> => ({ error: "Title is required" }),
    );

    render(<AddTaskDialog open action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(action).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Title is required",
    );
  });
});
