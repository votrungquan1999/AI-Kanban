// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BoardSettingsDialog } from "./board-settings.ui";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

describe("BoardSettingsDialog", () => {
  it("opens with the current default and saves a newly chosen default", async () => {
    const updateAction = vi.fn(async () => {});
    render(
      <BoardSettingsDialog
        defaultIntervalMs={TWO_HOURS_MS}
        updateAction={updateAction}
      />,
    );

    // When the user opens board settings
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));

    // The default-duration picker shows the current 2h default
    const picker = await screen.findByRole("combobox", {
      name: /default block duration/i,
    });
    expect(picker).toHaveTextContent("2h");

    // When they pick 4h and save
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: "4h" }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    // Then the new 4h default is persisted (not the prior 2h)
    expect(updateAction).toHaveBeenCalledWith(FOUR_HOURS_MS);
  });
});
