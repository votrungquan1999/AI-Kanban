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

  it("creates a text index over title and description", async () => {
    const db = await getDb();

    await bootstrapIndexes(db);
    await bootstrapIndexes(db); // running twice must not throw

    const indexes = await db.collection("cards").indexes();

    const byText = indexes.find((index) => index.key._fts === "text");
    expect(byText).toBeDefined();
    expect(byText?.weights).toEqual({ title: 1, description: 1 });
  });

  it("creates the recurring dueness, unique-number, and run-history indexes idempotently", async () => {
    const db = await getDb();

    await bootstrapIndexes(db);
    await bootstrapIndexes(db); // running twice must not throw

    const taskIndexes = await db.collection("recurring_tasks").indexes();

    // The dueness/claim scan composite (enabled, runState, nextDueAt)
    const byDueness = taskIndexes.find(
      (index) =>
        index.key.enabled === 1 &&
        index.key.runState === 1 &&
        index.key.nextDueAt === 1,
    );
    expect(byDueness).toBeDefined();

    // The unique monotonic number
    const byNumber = taskIndexes.find((index) => index.key.number === 1);
    expect(byNumber?.unique).toBe(true);

    // The chronological run-history index
    const runIndexes = await db.collection("recurring_runs").indexes();
    const byRun = runIndexes.find(
      (index) => index.key.recurringId === 1 && index.key.at === 1,
    );
    expect(byRun).toBeDefined();
  });
});
