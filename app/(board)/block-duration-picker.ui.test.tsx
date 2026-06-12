// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BlockDurationPicker } from "./block-duration-picker.ui";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

describe("BlockDurationPicker", () => {
  it("offers the board default and blocks for the chosen duration", async () => {
    const blockAction = vi.fn();
    render(
      <BlockDurationPicker
        cardId="card-1"
        defaultIntervalMs={TWO_HOURS_MS}
        blockAction={blockAction}
      />,
    );

    // The picker is pre-set to the board default (2h)
    const picker = screen.getByRole("combobox", { name: /block duration/i });
    expect(picker).toHaveTextContent("2h");

    // When the user picks 1h and clicks Block
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: "1h" }));
    await userEvent.click(screen.getByRole("button", { name: "Block" }));

    // Then the card is blocked for the chosen 1h, not the 2h default
    expect(blockAction).toHaveBeenCalledWith("card-1", ONE_HOUR_MS);
  });
});
