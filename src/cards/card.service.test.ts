import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createTask, listTasks, updateTaskStatus } from "@/cards/card.service";
import { OriginType, Status } from "@/cards/card.type";
import { ErrorCode } from "@/cards/errors";
import { bootstrapIndexes } from "@/db/indexes";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

describe("createTask", () => {
  useTestMongo();

  it("persists a todo card with an assigned number and defaults", async () => {
    const card = await createTask({
      title: "Write the board",
      origin: { type: OriginType.Manual },
    });

    expect(card.status).toBe(Status.Todo);
    expect(card.number).toBe(1);
    expect(card.priority).toBe(0);
    expect(card.title).toBe("Write the board");
    expect(card.id).toMatch(/^[a-f0-9]{24}$/);
    expect(card.origin).toEqual({ type: OriginType.Manual });
    expect(typeof card.createdAt).toBe("string");
  });

  it("rejects a duplicate open dedupeKey with ERR_DUPLICATE", async () => {
    const db = await getDb();
    await bootstrapIndexes(db);

    await createTask({
      title: "first",
      origin: { type: OriginType.Manual },
      dedupeKey: "notion:page-1",
    });

    await expect(
      createTask({
        title: "second",
        origin: { type: OriginType.Manual },
        dedupeKey: "notion:page-1",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.Duplicate });
  });

  it("allows multiple manual cards with null dedupeKey", async () => {
    const db = await getDb();
    await bootstrapIndexes(db);

    const first = await createTask({
      title: "manual a",
      origin: { type: OriginType.Manual },
    });
    const second = await createTask({
      title: "manual b",
      origin: { type: OriginType.Manual },
    });

    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe(Status.Todo);
    expect(second.status).toBe(Status.Todo);
  });
});

describe("listTasks", () => {
  useTestMongo();

  it("returns cards sorted by priority desc then createdAt asc", async () => {
    await createTask({
      title: "low-early",
      origin: { type: OriginType.Manual },
      priority: 1,
    });
    await createTask({
      title: "high",
      origin: { type: OriginType.Manual },
      priority: 5,
    });
    await createTask({
      title: "low-late",
      origin: { type: OriginType.Manual },
      priority: 1,
    });

    const cards = await listTasks();

    expect(cards.map((card) => card.title)).toEqual([
      "high",
      "low-early",
      "low-late",
    ]);
  });

  it("filters to a single status and returns clean client objects", async () => {
    const created = await createTask({
      title: "filter-me",
      origin: { type: OriginType.Manual },
    });

    const todos = await listTasks({ status: Status.Todo });
    expect(todos.some((card) => card.id === created.id)).toBe(true);
    for (const card of todos) {
      expect(card.status).toBe(Status.Todo);
    }
    expect(Object.keys(todos[0])).not.toContain("_id");

    const done = await listTasks({ status: Status.Done });
    expect(done).toHaveLength(0);
  });
});

describe("updateTaskStatus", () => {
  useTestMongo();

  it("moves a card to any status and sets lifecycle timestamps (UI override)", async () => {
    const card = await createTask({
      title: "move me",
      origin: { type: OriginType.Manual },
    });

    const inProgress = await updateTaskStatus(card.id, Status.InProgress);
    expect(inProgress.status).toBe(Status.InProgress);
    expect(inProgress.pickedAt).not.toBeNull();

    const done = await updateTaskStatus(card.id, Status.Done);
    expect(done.status).toBe(Status.Done);
    expect(done.finishedAt).not.toBeNull();
    expect(done.pickedAt).toBe(inProgress.pickedAt);
  });

  it("throws ERR_NOT_FOUND for an unknown id", async () => {
    await expect(
      updateTaskStatus(new ObjectId().toHexString(), Status.Done),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });
});
