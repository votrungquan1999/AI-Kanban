import type {
  Collection,
  Document,
  Filter,
  FindOneAndUpdateOptions,
  FindOptions,
  UpdateFilter,
} from "mongodb";
import type { ZodType } from "zod";
import { AppError, ErrorCode } from "@/cards/errors";

/**
 * Validates a document read out of Mongo against a schema. A parse failure is
 * schema drift (the stored shape diverged from the model): it is logged with
 * the Zod issues for developer investigation, then surfaced as a SchemaDrift
 * AppError rather than silently returning bad data. This is the one intentional
 * parse boundary for the read path.
 * @param schema - The schema the document must satisfy.
 * @param doc - The raw document read from the collection.
 * @returns The parsed, typed document.
 */
function parseOrThrow<T>(schema: ZodType<T>, doc: unknown): T {
  const result = schema.safeParse(doc);
  if (!result.success) {
    console.error("schema drift", {
      code: ErrorCode.SchemaDrift,
      issues: result.error.issues,
    });
    throw new AppError(
      ErrorCode.SchemaDrift,
      `document failed schema validation: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * Reads one document and validates it against a Zod schema (parse-on-read).
 * @param collection - The typed collection to read from.
 * @param filter - The query filter.
 * @param schema - The schema the stored document must satisfy.
 * @returns The parsed document, or `null` if no document matches.
 */
export async function findOneZ<T extends Document>(
  collection: Collection<T>,
  filter: Filter<T>,
  schema: ZodType<T>,
): Promise<T | null> {
  const doc = await collection.findOne(filter);
  if (!doc) return null;
  return parseOrThrow(schema, doc);
}

/**
 * Reads many documents and validates each against a Zod schema. Any one
 * drifted document fails the whole read (logged + thrown) — there is no
 * partial result.
 * @param collection - The typed collection to read from.
 * @param filter - The query filter.
 * @param schema - The schema each stored document must satisfy.
 * @param options - Optional find options (e.g. `sort`).
 * @returns The parsed documents (empty array if none match).
 */
export async function findManyZ<T extends Document>(
  collection: Collection<T>,
  filter: Filter<T>,
  schema: ZodType<T>,
  options?: FindOptions,
): Promise<T[]> {
  const docs = await collection.find(filter, options).toArray();
  return docs.map((doc) => parseOrThrow(schema, doc));
}

/**
 * Reads many documents via a Mongo projection and validates each against a
 * lean Zod schema. `TLean` is a second, independent generic (decoupled from
 * `TDoc`) so a projected read can return a shape smaller than the full
 * document, while `filter` still checks against the real document shape.
 * `projection` and `schema` have no compile-time link — a field added to one
 * and not the other throws SchemaDrift at read time; keep them edited together.
 * @param collection - The typed collection to read from.
 * @param filter - The query filter.
 * @param projection - The Mongo projection selecting exactly the lean fields.
 * @param schema - The lean schema each projected document must satisfy.
 * @param options - Optional find options besides `projection` (e.g. `sort`).
 * @returns The parsed lean documents (empty array if none match).
 */
export async function findManyProjectedZ<TDoc extends Document, TLean>(
  collection: Collection<TDoc>,
  filter: Filter<TDoc>,
  projection: Document,
  schema: ZodType<TLean>,
  options?: Omit<FindOptions, "projection">,
): Promise<TLean[]> {
  const docs = await collection
    .find(filter, { ...options, projection })
    .toArray();
  return docs.map((doc) => parseOrThrow(schema, doc));
}

/**
 * Atomically updates one document and validates the returned image against a
 * Zod schema. Pass `returnDocument: "after"` in options to validate the updated
 * image. A drifted result is logged + thrown (never returned as raw data).
 * @param collection - The typed collection to update.
 * @param filter - The query filter.
 * @param update - An update document or aggregation pipeline.
 * @param schema - The schema the returned document must satisfy.
 * @param options - Optional findOneAndUpdate options (e.g. `returnDocument`).
 * @returns The parsed document, or `null` if no document matched.
 */
export async function findOneAndUpdateZ<T extends Document>(
  collection: Collection<T>,
  filter: Filter<T>,
  update: UpdateFilter<T> | Document[],
  schema: ZodType<T>,
  options?: FindOneAndUpdateOptions,
): Promise<T | null> {
  const doc = await collection.findOneAndUpdate(filter, update, options ?? {});
  if (!doc) return null;
  return parseOrThrow(schema, doc);
}
