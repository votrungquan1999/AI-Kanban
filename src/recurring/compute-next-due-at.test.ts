import { describe, expect, it } from "vitest";
import { computeNextDueAt } from "@/recurring/compute-next-due-at";

describe("computeNextDueAt", () => {
  it("rolls the due time forward by everyHours from the given reference time", () => {
    // Given a fixed reference time
    const from = new Date("2026-06-04T00:00:00.000Z");

    // When rolling forward by the preset intervals (hourly / daily / weekly)
    // Then each result is exactly that many hours later
    expect(computeNextDueAt(1, from).toISOString()).toBe(
      "2026-06-04T01:00:00.000Z",
    );
    expect(computeNextDueAt(24, from).toISOString()).toBe(
      "2026-06-05T00:00:00.000Z",
    );
    expect(computeNextDueAt(168, from).toISOString()).toBe(
      "2026-06-11T00:00:00.000Z",
    );

    // And the reference time is not mutated
    expect(from.toISOString()).toBe("2026-06-04T00:00:00.000Z");
  });
});
