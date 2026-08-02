import { type ClientSession, type Db, MongoClient } from "mongodb";
import { bootstrapIndexes } from "@/db/indexes";

interface MongoConnection {
  client: MongoClient;
  db: Db;
}

interface MongoCacheSlot {
  cache?: MongoConnection;
  connecting?: Promise<MongoConnection>;
  bootstrapErrors?: Error[];
}

declare global {
  var __mongo: MongoCacheSlot | undefined;
}

/**
 * Returns the shared Mongo cache slot, lazily created on `globalThis`. Holding
 * the cache on `globalThis` (rather than module scope) lets a single
 * `MongoClient` survive serverless warm invocations and Next.js dev hot-reload.
 */
function slot(): MongoCacheSlot {
  globalThis.__mongo ??= {};
  return globalThis.__mongo;
}

/**
 * Returns a cached {@link Db} handle, connecting to `process.env.MONGODB_URI`
 * once. Concurrent first calls share a single in-flight connect promise, and
 * the connection is cached on `globalThis` so it survives serverless warm
 * invocations and Next.js dev hot-reload.
 */
export async function getDb(): Promise<Db> {
  const connection = await connect();
  return connection.db;
}

/**
 * Returns every error from the most recent index-bootstrap attempt — more
 * than one can fail since each index is isolated. Empty both when nothing
 * has failed and when bootstrap hasn't run yet; callers can't tell those
 * apart today.
 * @returns The caught errors, or `[]`.
 */
export function getIndexBootstrapErrors(): Error[] {
  return slot().bootstrapErrors ?? [];
}

function connect(): Promise<MongoConnection> {
  const mongo = slot();
  if (mongo.cache) return Promise.resolve(mongo.cache);

  if (!mongo.connecting) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");

    const client = new MongoClient(uri);
    mongo.connecting = client
      .connect()
      .then(async (connected) => {
        // Cache is set before the bootstrap await so calls arriving after
        // this point skip it; callers already awaiting `connecting` still wait.
        mongo.cache = { client, db: connected.db(process.env.MONGODB_DB) };
        try {
          // bootstrapIndexes isolates and logs each createIndex failure
          // itself and resolves with whatever it caught — record that for a
          // caller to read back, rather than relying on a throw here.
          mongo.bootstrapErrors = await bootstrapIndexes(mongo.cache.db);
        } catch (error) {
          // Fail-open backstop: bootstrapIndexes should never throw given its
          // own per-index isolation, but a bootstrap failure must never take
          // the board down even if something escapes that isolation.
          console.error("Index bootstrap failed unexpectedly:", error);
          mongo.bootstrapErrors = [
            error instanceof Error ? error : new Error(String(error)),
          ];
        }
        return mongo.cache;
      })
      .catch(async (error) => {
        // Clear the slot on ANY rejection here — connect() failing, or the
        // fulfilled continuation throwing (e.g. an invalid MONGODB_DB) —
        // so the next call retries instead of replaying a wedged failure.
        // Cache too: the continuation sets it before it can throw, and the
        // client it points at is closed just below.
        mongo.connecting = undefined;
        mongo.cache = undefined;
        await client.close().catch(() => {});
        throw error;
      });
  }

  return mongo.connecting;
}

/**
 * Runs `fn` inside a Mongo transaction on the shared cached client, committing
 * if it resolves and aborting (rolling back every write) if it throws — so a
 * multi-write sequence lands whole or not at all. Requires a replica-set /
 * mongos deployment (production Atlas and the test replica set both qualify).
 * @param fn - The work to run; every write must pass the given `session`.
 * @returns Whatever `fn` resolves to.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const { client } = await connect();
  const session = client.startSession();
  try {
    return await session.withTransaction(fn);
  } finally {
    await session.endSession();
  }
}

/** Closes the connection and clears the cache (for tests and shutdown). */
export async function closeMongo(): Promise<void> {
  const mongo = slot();
  if (mongo.cache) {
    await mongo.cache.client.close();
    mongo.cache = undefined;
  }
  mongo.connecting = undefined;
  mongo.bootstrapErrors = undefined;
}
