import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import type { CardDocument } from "@/cards/card.type";
import { OriginType, RunState, Status } from "@/cards/card.type";
import { ErrorCode } from "@/cards/errors";
import { cardsCollection } from "@/db/collections";
import { findManyZ, findOneAndUpdateZ, findOneZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

/** Builds a well-formed CardDocument for seeding. */
function makeCardDocument(overrides: Partial<CardDocument> = {}): CardDocument {
  const now = new Date();
  return {
    _id: new ObjectId(),
    number: 1,
    title: "A card",
    status: Status.Todo,
    priority: 0,
    origin: { type: OriginType.Manual },
    dedupeKey: null,
    runState: RunState.Idle,
    process: null,
    attempts: 0,
    restarts: 0,
    nextStartAfter: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    pickedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe("findOneZ", () => {
  useTestMongo();

  it("returns the parsed document for a matching, valid record", async () => {
    // Given a well-formed card in the collection
    const db = await getDb();
    const doc = makeCardDocument({ title: "Read me back" });
    await cardsCollection(db).insertOne(doc);

    // When reading it back through findOneZ
    const result = await findOneZ(
      cardsCollection(db),
      { _id: doc._id },
      cardDocumentSchema,
    );

    // Then the parsed document is returned with BSON types intact
    expect(result).not.toBeNull();
    expect(result?._id).toBeInstanceOf(ObjectId);
    expect(result?._id.toHexString()).toBe(doc._id.toHexString());
    expect(result?.title).toBe("Read me back");
    expect(result?.createdAt).toBeInstanceOf(Date);
  });

  it("returns null when no document matches the filter", async () => {
    // Given an empty collection
    const db = await getDb();

    // When reading a non-existent id
    const result = await findOneZ(
      cardsCollection(db),
      { _id: new ObjectId() },
      cardDocumentSchema,
    );

    // Then null is returned (no parse attempted)
    expect(result).toBeNull();
  });

  it("logs and throws a schema-drift error when the stored shape is invalid", async () => {
    // Given a stored doc that violates the schema (title is a number)
    const db = await getDb();
    const _id = new ObjectId();
    const malformed = { ...makeCardDocument({ _id }), title: 123 };
    await db.collection("cards").insertOne(malformed);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // When reading it back, Then it throws a SchemaDrift AppError and logs detail
    await expect(
      findOneZ(cardsCollection(db), { _id }, cardDocumentSchema),
    ).rejects.toMatchObject({ code: ErrorCode.SchemaDrift });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe("findManyZ", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await cardsCollection(db).deleteMany({});
  });

  it("returns the parsed documents for matching records", async () => {
    // Given two well-formed cards
    const db = await getDb();
    await cardsCollection(db).insertMany([
      makeCardDocument({ number: 1, title: "first" }),
      makeCardDocument({ number: 2, title: "second" }),
    ]);

    // When reading them all back through findManyZ
    const results = await findManyZ(
      cardsCollection(db),
      {},
      cardDocumentSchema,
    );

    // Then both parsed documents are returned
    expect(results).toHaveLength(2);
    expect(results.map((c) => c.title).sort()).toEqual(["first", "second"]);
    for (const card of results) {
      expect(card._id).toBeInstanceOf(ObjectId);
    }
  });

  it("returns an empty array when no documents match", async () => {
    // Given an empty collection
    const db = await getDb();

    // When reading with a filter that matches nothing
    const results = await findManyZ(
      cardsCollection(db),
      { status: Status.Done },
      cardDocumentSchema,
    );

    // Then an empty array is returned
    expect(results).toEqual([]);
  });

  it("forwards find options such as sort", async () => {
    // Given three cards inserted out of priority order
    const db = await getDb();
    await cardsCollection(db).insertMany([
      makeCardDocument({ number: 1, priority: 1 }),
      makeCardDocument({ number: 2, priority: 3 }),
      makeCardDocument({ number: 3, priority: 2 }),
    ]);

    // When reading them sorted by priority descending
    const results = await findManyZ(
      cardsCollection(db),
      {},
      cardDocumentSchema,
      { sort: { priority: -1 } },
    );

    // Then they come back in the requested order
    expect(results.map((c) => c.priority)).toEqual([3, 2, 1]);
  });

  it("logs and throws when any matched document drifts from the schema", async () => {
    // Given one valid card and one malformed card
    const db = await getDb();
    await cardsCollection(db).insertOne(makeCardDocument({ title: "good" }));
    await db
      .collection("cards")
      .insertOne({ ...makeCardDocument(), priority: "high" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // When reading all of them, Then the whole read fails with SchemaDrift
    await expect(
      findManyZ(cardsCollection(db), {}, cardDocumentSchema),
    ).rejects.toMatchObject({ code: ErrorCode.SchemaDrift });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe("findOneAndUpdateZ", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await cardsCollection(db).deleteMany({});
  });

  it("returns the parsed updated image when returnDocument is after", async () => {
    // Given a stored card
    const db = await getDb();
    const doc = makeCardDocument({ title: "before" });
    await cardsCollection(db).insertOne(doc);

    // When updating its title and asking for the after image
    const result = await findOneAndUpdateZ(
      cardsCollection(db),
      { _id: doc._id },
      { $set: { title: "after" } },
      cardDocumentSchema,
      { returnDocument: "after" },
    );

    // Then the parsed, updated document is returned
    expect(result?.title).toBe("after");
    expect(result?._id).toBeInstanceOf(ObjectId);
  });

  it("returns null when no document matches the filter", async () => {
    // Given an empty collection
    const db = await getDb();

    // When updating a non-existent id
    const result = await findOneAndUpdateZ(
      cardsCollection(db),
      { _id: new ObjectId() },
      { $set: { title: "x" } },
      cardDocumentSchema,
      { returnDocument: "after" },
    );

    // Then null is returned (no parse attempted)
    expect(result).toBeNull();
  });

  it("logs and throws when the returned image drifts from the schema", async () => {
    // Given a stored doc that is already malformed (priority is a string)
    const db = await getDb();
    const _id = new ObjectId();
    await db
      .collection("cards")
      .insertOne({ ...makeCardDocument({ _id }), priority: "high" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // When updating an unrelated field and reading the (still-drifted) after image
    await expect(
      findOneAndUpdateZ(
        cardsCollection(db),
        { _id },
        { $set: { title: "touched" } },
        cardDocumentSchema,
        { returnDocument: "after" },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SchemaDrift });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
