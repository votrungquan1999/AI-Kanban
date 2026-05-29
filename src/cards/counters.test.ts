import { describe, expect, it } from "vitest";
import { nextNumber } from "@/cards/counters";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

describe("nextNumber", () => {
  useTestMongo();

  it("returns sequential gap-free numbers starting at 1", async () => {
    const db = await getDb();

    expect(await nextNumber(db)).toBe(1);
    expect(await nextNumber(db)).toBe(2);
    expect(await nextNumber(db)).toBe(3);
  });

  it("never returns duplicate numbers under concurrency", async () => {
    const db = await getDb();

    const numbers = await Promise.all(
      Array.from({ length: 25 }, () => nextNumber(db)),
    );

    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
