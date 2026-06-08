// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AddRecurringState } from "./add-recurring.type";
import { AddRecurringDialog } from "./add-recurring-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

describe("AddRecurringDialog", () => {
  it("submits the form and shows the action's validation error", async () => {
    const action = vi.fn(
      async (): Promise<AddRecurringState> => ({
        error: "title is required",
      }),
    );

    render(<AddRecurringDialog open action={action} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Add recurring task" }),
    );

    expect(action).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "title is required",
    );
  });
});
