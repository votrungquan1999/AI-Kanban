import { describe, expect, it } from "vitest";
import {
  cardIdSchema,
  createTaskInputSchema,
  statusSchema,
} from "@/cards/card.schema";

describe("createTaskInputSchema", () => {
  it("parses a valid manual create input and defaults priority to 0", () => {
    const result = createTaskInputSchema.parse({
      title: "Do the thing",
      origin: { type: "manual" },
    });

    expect(result.title).toBe("Do the thing");
    expect(result.origin).toEqual({ type: "manual" });
    expect(result.priority).toBe(0);
  });

  it("rejects invalid input: missing title, bad status, malformed origin, bad id", () => {
    expect(() =>
      createTaskInputSchema.parse({ origin: { type: "manual" } }),
    ).toThrow();
    expect(() =>
      createTaskInputSchema.parse({ title: "x", origin: { type: "nope" } }),
    ).toThrow();
    expect(() => statusSchema.parse("archived")).toThrow();
    expect(() => cardIdSchema.parse("not-an-objectid")).toThrow();

    expect(statusSchema.parse("need_review")).toBe("need_review");
    expect(cardIdSchema.parse("0123456789abcdef01234567")).toBe(
      "0123456789abcdef01234567",
    );
  });
});
