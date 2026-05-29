import { describe, expect, it } from "vitest";
import { bootstrapIndexes } from "@/db/indexes";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

describe("bootstrapIndexes", () => {
  useTestMongo();

  it("creates the three cards indexes and is idempotent", async () => {
    const db = await getDb();

    await bootstrapIndexes(db);
    await bootstrapIndexes(db); // running twice must not throw

    const indexes = await db.collection("cards").indexes();

    const byNumber = indexes.find((index) => index.key.number === 1);
    expect(byNumber?.unique).toBe(true);

    const byDedupe = indexes.find((index) => index.key.dedupeKey === 1);
    expect(byDedupe?.unique).toBe(true);
    expect(byDedupe?.partialFilterExpression).toBeDefined();

    const byColumn = indexes.find(
      (index) =>
        index.key.status === 1 &&
        index.key.priority === -1 &&
        index.key.createdAt === 1,
    );
    expect(byColumn).toBeDefined();
  });
});
