// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalNav } from "./global-nav.ui";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname }));

afterEach(() => {
  usePathname.mockReset();
});

describe("GlobalNav", () => {
  it("renders the Board and Recurring links with their hrefs", () => {
    usePathname.mockReturnValue("/");

    render(<GlobalNav />);

    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Recurring" })).toHaveAttribute(
      "href",
      "/recurring",
    );
  });

  it("marks the Board link active on the board path", () => {
    usePathname.mockReturnValue("/");

    render(<GlobalNav />);

    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Recurring" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the Recurring link active on the recurring path", () => {
    usePathname.mockReturnValue("/recurring");

    render(<GlobalNav />);

    expect(screen.getByRole("link", { name: "Recurring" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Board" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
