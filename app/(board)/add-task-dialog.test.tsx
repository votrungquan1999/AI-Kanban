// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AddTaskState } from "./add-task.type";
import { AddTaskDialog } from "./add-task-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

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

  it("offers a P0–P3 priority selector defaulting to P0", async () => {
    const action = vi.fn(async (): Promise<AddTaskState> => ({}));

    render(<AddTaskDialog open action={action} />);

    // The priority selector defaults to P0
    const priority = await screen.findByRole("combobox", { name: /priority/i });
    expect(priority).toHaveTextContent("P0");

    // And opening it reveals the full P0–P3 range
    await userEvent.click(priority);
    expect(
      await screen.findByRole("option", { name: "P3" }),
    ).toBeInTheDocument();
  });
});
