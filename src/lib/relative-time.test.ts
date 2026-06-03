import { describe, expect, it } from "vitest";
import { formatRelativeAge } from "@/lib/relative-time";

describe("formatRelativeAge", () => {
  it("formats a past timestamp relative to the injected now", () => {
    const now = new Date("2026-01-03T00:00:00.000Z");
    expect(formatRelativeAge("2026-01-01T00:00:00.000Z", now)).toBe(
      "2 days ago",
    );
  });

  it("uses coarser units as the gap widens", () => {
    const now = new Date("2026-01-01T03:00:00.000Z");
    expect(formatRelativeAge("2026-01-01T00:00:00.000Z", now)).toBe(
      "3 hours ago",
    );
  });
});
