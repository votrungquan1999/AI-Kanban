import { describe, expect, it } from "vitest";
import { formatSchedule } from "./format-schedule";

describe("formatSchedule", () => {
  it("labels the hourly/daily/weekly presets and falls back to an N-hour label", () => {
    // Given the three locked presets and an arbitrary custom interval
    // Then each preset reads as a word and the custom value reads as "Every Nh"
    expect(formatSchedule(1)).toBe("Hourly");
    expect(formatSchedule(24)).toBe("Daily");
    expect(formatSchedule(168)).toBe("Weekly");
    expect(formatSchedule(6)).toBe("Every 6 hours");
  });
});
