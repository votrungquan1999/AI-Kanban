import { MongoClient } from "mongodb";
import { describe, expect, it } from "vitest";
import { closeMongo, getDb, getIndexBootstrapErrors } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

describe("getDb", () => {
  useTestMongo();

  it("returns the same cached Db handle across calls (connects once)", async () => {
    const first = await getDb();
    const second = await getDb();

    expect(second).toBe(first);
  });
});

describe("getDb — reconnects after a failed connect", () => {
  useTestMongo();

  it("retries on the next call instead of replaying the earlier failure", async () => {
    // Given a clean slate and a URI that fails fast (nothing listens on port 1)
    const goodUri = process.env.MONGODB_URI ?? "";
    await closeMongo();
    process.env.MONGODB_URI =
      "mongodb://127.0.0.1:1/test?serverSelectionTimeoutMS=300";

    try {
      // When the first connection attempt fails
      await expect(getDb()).rejects.toThrow(
        /MongoServerSelectionError|ECONNREFUSED/,
      );

      // Then a subsequent call with a working URI succeeds instead of replaying the failure
      process.env.MONGODB_URI = goodUri;
      await expect(getDb()).resolves.toBeTruthy();
    } finally {
      process.env.MONGODB_URI = goodUri;
    }
  });
});

describe("getDb — bootstraps indexes on first connect", () => {
  useTestMongo();

  it("keyword search works without the test manually calling bootstrapIndexes", async () => {
    // Given a plain getDb() call — nobody bootstraps indexes by hand here
    const db = await getDb();
    await db.collection("cards").insertOne({ title: "widget thing" });

    // When searching by keyword
    const results = await db
      .collection("cards")
      .find({ $text: { $search: "widget" } })
      .toArray();

    // Then it returns the matching card instead of failing
    expect(results).toHaveLength(1);
  });
});

describe("getDb — survives a bootstrap failure", () => {
  useTestMongo();

  it("still returns a working db, with the failure recorded, when index preparation fails", async () => {
    // Given duplicate dedupeKeys on two open cards — seeded via a raw client so
    // this insert doesn't itself trigger the connect()-driven bootstrap under test.
    const seedClient = new MongoClient(process.env.MONGODB_URI as string);
    await seedClient.connect();
    await seedClient
      .db()
      .collection("cards")
      .insertMany([
        { number: 1, title: "a", status: "todo", dedupeKey: "dup" },
        { number: 2, title: "b", status: "todo", dedupeKey: "dup" },
      ]);
    await seedClient.close();

    // When the first real getDb() of this describe drives a fresh connect(),
    // whose bootstrap hits a genuine E11000 building the partial-unique index
    // over that duplicate data
    const db = await getDb();

    // Then the board stays usable
    expect(db).toBeTruthy();
    const created = await db
      .collection("cards")
      .insertOne({ number: 3, title: "c" });
    expect(created.acknowledged).toBe(true);
    const read = await db.collection("cards").findOne({ number: 3 });
    expect(read?.title).toBe("c");

    // And the failure is recorded somewhere a caller can read it back
    const errors = getIndexBootstrapErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });
});
