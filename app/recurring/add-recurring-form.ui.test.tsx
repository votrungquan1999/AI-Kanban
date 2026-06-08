// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";
import { AddRecurringForm } from "./add-recurring-form.ui";

describe("AddRecurringForm", () => {
  it("renders title, instruction, schedule, and custom-interval fields", () => {
    render(
      <Dialog open>
        <AddRecurringForm formAction={vi.fn()} pending={false} />
      </Dialog>,
    );

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Instruction")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /schedule/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/every n hours/i)).toBeInTheDocument();
  });
});
