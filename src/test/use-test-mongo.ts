import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { closeMongo, getDb } from "@/db/mongo";

/**
 * Boots an in-memory mongod for the current test file and points
 * `process.env.MONGODB_URI` at it; tears down and clears the connection cache
 * afterwards. Call once at the top of an integration `describe`. Runs as a
 * single-node replica set (not a bare mongod) so code paths using Mongo
 * transactions — which require a replica set — work under test.
 */
export function useTestMongo(): void {
  let server: MongoMemoryReplSet;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = server.getUri();
  });

  afterAll(async () => {
    await closeMongo();
    await server.stop();
  });
}

/**
 * Registers a `beforeEach` that empties every collection between tests, so
 * tests in one file don't leak state into each other. Needed where tests share
 * a session handle: `createCard` is idempotent per session, so a leaked
 * in-progress card would be adopted by the next test instead of created fresh.
 * Pair with {@link useTestMongo} inside the same file.
 */
export function clearCollectionsEachTest(): void {
  beforeEach(async () => {
    const db = await getDb();
    const collections = await db.collections();
    await Promise.all(
      collections.map((collection) => collection.deleteMany({})),
    );
  });
}
