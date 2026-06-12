import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
} from "@/cards/card.service";
import { OriginType, RunState, Status } from "@/cards/card.type";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
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

describe("card workspace bookkeeping", () => {
  useTestMongo();

  it("creates a card with empty workspace bookkeeping that survives a read", async () => {
    // Given a clean board
    // When a card is created and read back from storage
    const created = await createTask({
      title: "workspace card",
      origin: { type: OriginType.Manual },
    });
    const fetched = await getTask(created.id);

    // Then both the created and re-read client cards expose empty workspace
    // bookkeeping (no path, no repos) — proving the round-trip carries the new
    // fields without a schema-drift rejection
    expect(created.workspacePath).toBeNull();
    expect(created.repos).toEqual([]);
    expect(fetched.workspacePath).toBeNull();
    expect(fetched.repos).toEqual([]);
  });

  it("rejects a stored card missing the workspace bookkeeping as schema drift", async () => {
    // Given a card stored in the old shape (no workspacePath/repos), inserted
    // raw via the driver to bypass createTask's new field initializers
    const db = await getDb();
    const _id = new ObjectId();
    const now = new Date();
    const legacyDoc = {
      _id,
      number: 1,
      title: "legacy card",
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
    };
    await cardsCollection(db).insertOne(legacyDoc as never);

    // When it is read back, Then the parse-on-read rejects it as schema drift —
    // proving the new bookkeeping is required, not silently defaulted
    await expect(getTask(_id.toHexString())).rejects.toMatchObject({
      code: ErrorCode.SchemaDrift,
    });
  });
});

describe("getTask", () => {
  useTestMongo();

  it("returns the client-facing card for an existing id", async () => {
    // Given an existing card
    const created = await createTask({
      title: "read me",
      origin: { type: OriginType.Manual },
    });

    // When it is fetched by id
    const fetched = await getTask(created.id);

    // Then the clean client Card is returned (no raw _id leak)
    expect(fetched).toEqual(created);
    expect(Object.keys(fetched)).not.toContain("_id");
  });

  it("throws ERR_NOT_FOUND for an unknown id", async () => {
    // Given a well-formed but unused id, When fetched, Then it is not found
    await expect(getTask(new ObjectId().toHexString())).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
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
      priority: 3,
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

  it("excludes archived cards from the default board list but keeps them on an explicit archived filter", async () => {
    // Given an open card and an archived card
    const open = await createTask({
      title: "stays-open",
      origin: { type: OriginType.Manual },
    });
    const toArchive = await createTask({
      title: "to-archive",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(toArchive.id, Status.Archived);

    // When listing the default board (no filter), the archived card is hidden
    const board = await listTasks();
    expect(board.some((card) => card.id === toArchive.id)).toBe(false);
    expect(board.some((card) => card.id === open.id)).toBe(true);

    // But an explicit archived filter still returns it (and only archived cards)
    const archived = await listTasks({ status: Status.Archived });
    expect(archived.map((card) => card.id)).toContain(toArchive.id);
    expect(archived.every((card) => card.status === Status.Archived)).toBe(
      true,
    );
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

  it("blocks a card for a chosen interval and remembers that interval", async () => {
    // Given a fresh card
    const card = await createTask({
      title: "block me for an hour",
      origin: { type: OriginType.Manual },
    });
    const ONE_HOUR_MS = 60 * 60 * 1000;

    // When the user blocks it with an explicit 1-hour interval
    const blocked = await updateTaskStatus(card.id, Status.Blocked, {
      intervalMs: ONE_HOUR_MS,
    });

    // Then the card remembers the chosen interval and its deadline is ~1h out
    // (the chosen value, not the 2h board default)
    expect(blocked.blockInterval).toBe(ONE_HOUR_MS);
    const deadlineMs = new Date(blocked.blockedUntil as string).getTime();
    expect(Math.abs(deadlineMs - (Date.now() + ONE_HOUR_MS))).toBeLessThan(
      60_000,
    );
  });

  it("replays the card's own interval when its timer is reset with no new one", async () => {
    // Given a card blocked with an explicit 1-hour interval
    const card = await createTask({
      title: "reset me",
      origin: { type: OriginType.Manual },
    });
    const ONE_HOUR_MS = 60 * 60 * 1000;
    await updateTaskStatus(card.id, Status.Blocked, {
      intervalMs: ONE_HOUR_MS,
    });

    // When the user resets the timer (re-enters Blocked WITHOUT a new interval)
    const reset = await updateTaskStatus(card.id, Status.Blocked);

    // Then the countdown restarts from the card's OWN 1-hour interval, not the
    // 2h board default
    expect(reset.blockInterval).toBe(ONE_HOUR_MS);
    const deadlineMs = new Date(reset.blockedUntil as string).getTime();
    expect(Math.abs(deadlineMs - (Date.now() + ONE_HOUR_MS))).toBeLessThan(
      60_000,
    );
  });

  it("falls back to the board default when resetting a legacy blocked card with no stored interval", async () => {
    // Given a legacy blocked card that never recorded an interval (blockInterval null)
    const card = await createTask({
      title: "legacy block",
      origin: { type: OriginType.Manual },
    });
    const db = await getDb();
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(card.id) },
      {
        $set: {
          status: Status.Blocked,
          blockInterval: null,
          blockedUntil: new Date(Date.now() + 60_000),
        },
      },
    );

    // When its timer is reset (re-enters Blocked with no interval)
    const reset = await updateTaskStatus(card.id, Status.Blocked);

    // Then it falls back to the seeded 2h board default
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    expect(reset.blockInterval).toBe(TWO_HOURS_MS);
    const deadlineMs = new Date(reset.blockedUntil as string).getTime();
    expect(Math.abs(deadlineMs - (Date.now() + TWO_HOURS_MS))).toBeLessThan(
      60_000,
    );
  });

  it("lets the UI jump straight todo -> done (override, no edge constraint)", async () => {
    // Given a fresh todo card
    const card = await createTask({
      title: "override me",
      origin: { type: OriginType.Manual },
    });

    // When the UI moves it directly to done (an edge the agent may NOT take)
    const done = await updateTaskStatus(card.id, Status.Done);

    // Then it succeeds and stamps finishedAt — UI bypasses the from-set filter
    expect(done.status).toBe(Status.Done);
    expect(done.finishedAt).not.toBeNull();
  });

  it("lets the agent move along a legal edge and stamps lifecycle fields", async () => {
    // Given a card the UI has moved into in_progress (a legal agent `from`)
    const card = await createTask({
      title: "agent finishes",
      origin: { type: OriginType.Manual },
    });
    const inProgress = await updateTaskStatus(card.id, Status.InProgress);
    expect(inProgress.pickedAt).not.toBeNull();

    // When the agent moves it along the legal in_progress -> done edge
    const done = await updateTaskStatus(card.id, Status.Done, {
      caller: Caller.Agent,
    });

    // Then it moves, stamps finishedAt, and preserves the original pickedAt
    expect(done.status).toBe(Status.Done);
    expect(done.finishedAt).not.toBeNull();
    expect(done.pickedAt).toBe(inProgress.pickedAt);
  });

  it("rejects an agent move from an illegal source status", async () => {
    // Given a card still in todo (not a legal agent source for done)
    const card = await createTask({
      title: "agent jumps the queue",
      origin: { type: OriginType.Manual },
    });

    // When the agent tries the illegal todo -> done edge, Then it is rejected
    await expect(
      updateTaskStatus(card.id, Status.Done, { caller: Caller.Agent }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidTransition });

    // And the card is unchanged (still todo)
    const after = await getTask(card.id);
    expect(after.status).toBe(Status.Todo);
  });

  it("throws ERR_NOT_FOUND for an unknown id", async () => {
    await expect(
      updateTaskStatus(new ObjectId().toHexString(), Status.Done),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });

  it("reports an agent move on a missing card as not-found, not invalid-transition", async () => {
    // Given a well-formed but unused id, When the agent moves it,
    // Then the miss disambiguates to NotFound (no card), not InvalidTransition.
    await expect(
      updateTaskStatus(new ObjectId().toHexString(), Status.Done, {
        caller: Caller.Agent,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });
});
