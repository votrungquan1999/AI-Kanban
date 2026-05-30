import { afterEach, describe, expect, it } from "vitest";
import { readCardId } from "@/mcp/index";

describe("readCardId", () => {
  const original = process.env.CARD_ID;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CARD_ID;
    } else {
      process.env.CARD_ID = original;
    }
  });

  it("returns the validated CARD_ID from the environment", () => {
    const id = "a".repeat(24);
    process.env.CARD_ID = id;
    expect(readCardId()).toBe(id);
  });

  it("throws when CARD_ID is missing", () => {
    delete process.env.CARD_ID;
    expect(() => readCardId()).toThrow();
  });

  it("throws when CARD_ID is malformed", () => {
    process.env.CARD_ID = "not-a-hex-id";
    expect(() => readCardId()).toThrow();
  });
});
