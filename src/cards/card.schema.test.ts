import { describe, expect, it } from "vitest";
import {
  cardIdSchema,
  createTaskInputSchema,
  statusSchema,
  updateTaskInputSchema,
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
    expect(() => statusSchema.parse("not_a_status")).toThrow();
    expect(() => cardIdSchema.parse("not-an-objectid")).toThrow();

    expect(statusSchema.parse("archived")).toBe("archived");
    expect(statusSchema.parse("need_review")).toBe("need_review");
    expect(cardIdSchema.parse("0123456789abcdef01234567")).toBe(
      "0123456789abcdef01234567",
    );
  });

  it("rejects a priority outside the P0–P3 range and accepts an in-range one", () => {
    expect(() =>
      createTaskInputSchema.parse({
        title: "x",
        origin: { type: "manual" },
        priority: 5,
      }),
    ).toThrow();
    expect(() =>
      createTaskInputSchema.parse({
        title: "x",
        origin: { type: "manual" },
        priority: -1,
      }),
    ).toThrow();
    expect(
      createTaskInputSchema.parse({
        title: "x",
        origin: { type: "manual" },
        priority: 3,
      }).priority,
    ).toBe(3);
  });
});

describe("updateTaskInputSchema", () => {
  it("accepts a partial patch and an empty patch without forcing a priority default", () => {
    expect(updateTaskInputSchema.parse({ description: "new" })).toEqual({
      description: "new",
    });
    expect(updateTaskInputSchema.parse({})).toEqual({});
  });

  it("rejects an empty title and out-of-range priority, but accepts a blank description", () => {
    expect(() => updateTaskInputSchema.parse({ title: "" })).toThrow();
    expect(() => updateTaskInputSchema.parse({ priority: 4 })).toThrow();
    expect(updateTaskInputSchema.parse({ description: "" })).toEqual({
      description: "",
    });
  });
});
