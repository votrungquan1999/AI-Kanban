import { type Db, MongoClient } from "mongodb";

interface MongoConnection {
  client: MongoClient;
  db: Db;
}

interface MongoCacheSlot {
  cache?: MongoConnection;
  connecting?: Promise<MongoConnection>;
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

function connect(): Promise<MongoConnection> {
  const mongo = slot();
  if (mongo.cache) return Promise.resolve(mongo.cache);

  if (!mongo.connecting) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");

    const client = new MongoClient(uri);
    mongo.connecting = client.connect().then((connected) => {
      mongo.cache = { client, db: connected.db(process.env.MONGODB_DB) };
      return mongo.cache;
    });
  }

  return mongo.connecting;
}

/** Closes the connection and clears the cache (for tests and shutdown). */
export async function closeMongo(): Promise<void> {
  const mongo = slot();
  if (mongo.cache) {
    await mongo.cache.client.close();
    mongo.cache = undefined;
  }
  mongo.connecting = undefined;
}
