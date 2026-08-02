import { MongoClient } from "mongodb";
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

// Own describe + own useTestMongo(): the suite above never clears collections,
// so by this point the real unique dedupeKey index already exists there and a
// duplicate seed would fail at insert time, not at createIndex time — a fresh
// replica set is required for the seed to reach bootstrapIndexes at all.
describe("bootstrapIndexes — one failing index doesn't cost the others", () => {
  useTestMongo();

  it("still creates the text index when the dedupeKey index fails to build", async () => {
    // Seed via a raw client, not getDb(): getDb() itself now drives
    // connect()'s auto-bootstrap (Behavior 3/4), which would build the unique
    // dedupeKey index before this insert ever runs, turning the intended
    // createIndex-time E11000 into an insert-time one instead.
    const client = new MongoClient(process.env.MONGODB_URI as string);
    try {
      await client.connect();
      const db = client.db();
      await db.collection("cards").insertMany([
        {
          number: 1,
          title: "a",
          status: "todo",
          priority: 0,
          dedupeKey: "dup",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          number: 2,
          title: "b",
          status: "todo",
          priority: 0,
          dedupeKey: "dup",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const errors = await bootstrapIndexes(db);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(Error);

      const indexes = await db.collection("cards").indexes();
      expect(indexes.find((index) => index.key._fts === "text")).toBeDefined();

      // Also prove a survivor called AFTER the failing dedupeKey index, not
      // just one before it — isolation must not stop at the failure point.
      const eventIndexes = await db.collection("card_events").indexes();
      expect(
        eventIndexes.find(
          (index) => index.key.cardId === 1 && index.key.at === 1,
        ),
      ).toBeDefined();
    } finally {
      await client.close();
    }
  });
});
