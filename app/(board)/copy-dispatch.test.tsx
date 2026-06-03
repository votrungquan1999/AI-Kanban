// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/toaster";
import { CopyDispatch } from "./copy-dispatch.ui";

const CARD_ID = "0123456789abcdef01234567";

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

/**
 * Install a fake clipboard whose `writeText` we can assert on, returning it.
 */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    ...(originalClipboard ?? { value: undefined }),
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe("CopyDispatch", () => {
  it("copies the ready-to-run dispatch command and confirms with a toast", async () => {
    // Given a stubbed clipboard
    const writeText = stubClipboard();

    render(
      <ToastProvider>
        <CopyDispatch cardId={CARD_ID} />
        <Toaster />
      </ToastProvider>,
    );

    // When the operator taps the copy control
    await userEvent.click(
      screen.getByRole("button", { name: /copy dispatch command/i }),
    );

    // Then the exact dispatch command lands on the clipboard
    expect(writeText).toHaveBeenCalledWith(`/ai-kanban-work-card ${CARD_ID}`);

    // And a confirmation toast appears
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it("offers copying just the raw card id from the menu", async () => {
    // Given a stubbed clipboard
    const writeText = stubClipboard();

    render(
      <ToastProvider>
        <CopyDispatch cardId={CARD_ID} />
        <Toaster />
      </ToastProvider>,
    );

    // When the operator opens the copy menu
    await userEvent.click(
      screen.getByRole("button", { name: /copy options/i }),
    );

    // Then it offers both the command and the id (menu opens on the next frame)
    expect(
      await screen.findByRole("menuitem", { name: /command/i }),
    ).toBeInTheDocument();

    // When the operator picks "id"
    await userEvent.click(screen.getByRole("menuitem", { name: /copy id/i }));

    // Then only the bare 24-character id lands on the clipboard
    expect(writeText).toHaveBeenCalledWith(CARD_ID);
  });
});
