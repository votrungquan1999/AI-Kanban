import { beforeEach, describe, expect, it } from "vitest";
import { nextNumber } from "@/cards/counters";
import { countersCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

describe("nextNumber", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await countersCollection(db).deleteMany({});
  });

  it("returns sequential gap-free numbers starting at 1", async () => {
    const db = await getDb();

    expect(await nextNumber(db, "cards")).toBe(1);
    expect(await nextNumber(db, "cards")).toBe(2);
    expect(await nextNumber(db, "cards")).toBe(3);
  });

  it("gives each counterId its own independent sequence", async () => {
    const db = await getDb();

    // Advancing one counter must not affect another counter's sequence.
    expect(await nextNumber(db, "cards")).toBe(1);
    expect(await nextNumber(db, "cards")).toBe(2);
    expect(await nextNumber(db, "recurring_tasks")).toBe(1);
    expect(await nextNumber(db, "recurring_tasks")).toBe(2);
    expect(await nextNumber(db, "cards")).toBe(3);
  });

  it("returns the full gap-free 1..N range under concurrency", async () => {
    const db = await getDb();

    const numbers = await Promise.all(
      Array.from({ length: 25 }, () => nextNumber(db, "cards")),
    );

    // Gap-free monotonic: the 25 concurrent calls collectively yield exactly
    // 1..25 (no duplicates, no gaps), regardless of completion order.
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });
});
