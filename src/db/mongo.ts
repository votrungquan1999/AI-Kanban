import { MongoClient, type Db } from "mongodb";

interface MongoConnection {
  client: MongoClient;
  db: Db;
}

let cache: MongoConnection | undefined;
let connecting: Promise<MongoConnection> | undefined;

/**
 * Returns a cached {@link Db} handle, connecting to `process.env.MONGODB_URI`
 * once. Concurrent first calls share a single in-flight connect promise, and a
 * module-level cache survives Next.js dev hot-reload.
 */
export async function getDb(): Promise<Db> {
  const connection = await connect();
  return connection.db;
}

function connect(): Promise<MongoConnection> {
  if (cache) return Promise.resolve(cache);

  if (!connecting) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");

    const client = new MongoClient(uri);
    connecting = client.connect().then((connected) => {
      cache = { client, db: connected.db(process.env.MONGODB_DB) };
      return cache;
    });
  }

  return connecting;
}

/** Closes the connection and clears the cache (for tests and shutdown). */
export async function closeMongo(): Promise<void> {
  if (cache) {
    await cache.client.close();
    cache = undefined;
  }
  connecting = undefined;
}
