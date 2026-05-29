import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll } from "vitest";
import { closeMongo } from "@/db/mongo";

/**
 * Boots an in-memory mongod for the current test file and points
 * `process.env.MONGODB_URI` at it; tears down and clears the connection cache
 * afterwards. Call once at the top of an integration `describe`.
 */
export function useTestMongo(): void {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    process.env.MONGODB_URI = server.getUri();
  });

  afterAll(async () => {
    await closeMongo();
    await server.stop();
  });
}
