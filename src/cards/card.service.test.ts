import { Collection, ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import {
  createCard,
  createTask,
  getTask,
  listCards,
  listTasks,
  updateTaskStatus,
} from "@/cards/card.service";
import type { CardDocument } from "@/cards/card.type";
import { OriginType, RunState, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind, EventOutcome } from "@/cards/card-event.type";
import { nextNumber } from "@/cards/counters";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection, countersCollection } from "@/db/collections";
import { bootstrapIndexes } from "@/db/indexes";
import { getDb } from "@/db/mongo";
import { clearCollectionsEachTest, useTestMongo } from "@/test/use-test-mongo";

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

describe("createCard", () => {
  useTestMongo();

  it("creates a card directly in in_progress with running state and a pick-up time", async () => {
    // Given a session ready to track its work
    // When it creates a card with a title, tags, and its session handle
    const card = await createCard({
      title: "Implement dark mode toggle",
      tags: ["frontend", "ui"],
      sessionId: "abc123session",
    });

    // Then the card is immediately in progress (not parked in todo) and picked up
    expect(card.status).toBe(Status.InProgress);
    expect(card.pickedAt).not.toBeNull();

    // And exactly one create audit event (null -> in_progress) was recorded, by
    // the Agent caller — distinguishing a session create from a UI createTask
    const events = await listCardEvents(card.id);
    expect(events).toHaveLength(1);
    const [createEvent] = events;
    // Narrow to the status-transition shape so `from`/`to` are assertable
    if (createEvent.kind !== CardEventKind.StatusTransition) {
      throw new Error("expected a status-transition create event");
    }
    expect(createEvent.from).toBeNull();
    expect(createEvent.to).toBe(Status.InProgress);
    expect(createEvent.caller).toBe(Caller.Agent);
    expect(createEvent.outcome).toBe(EventOutcome.Success);
  });

  it("stores tags and sessionId verbatim on the returned card, with an empty progress history", async () => {
    // Given specific tags and a session handle
    const tags = ["frontend", "dark-mode"];
    const sessionId = "session-xyz-789";

    // When the card is created
    const card = await createCard({
      title: "Track session work",
      tags,
      sessionId,
    });

    // Then the tags come back exactly as given, the handle is unchanged, and the
    // progress history starts empty
    expect(card.tags).toEqual(["frontend", "dark-mode"]);
    expect(card.sessionId).toBe("session-xyz-789");
    expect(card.progress).toEqual([]);
  });

  it("accepts and stores an empty tags array without modification", async () => {
    // Given a session that supplies no tags
    // When the card is created with an empty tags array
    const card = await createCard({
      title: "No tags card",
      tags: [],
      sessionId: "session-no-tags",
    });

    // Then tags is an empty array (not rejected, not coerced to null/undefined)
    expect(card.tags).toEqual([]);
  });

  it("creates a card without a session id, recording no session", async () => {
    // Given an operator (not a session) creating a card
    // When it is created with no sessionId at all
    const card = await createCard({
      title: "Operator-created card",
      tags: [],
    });

    // Then the card records no session
    expect(card.sessionId).toBeNull();
  });

  it("stores a nextAction given at creation and returns it on the card", async () => {
    // Given a session that knows what it'll do next, with surrounding
    // whitespace around the value (D8: trimmed on the way in)
    // When it creates a card noting that next step
    const card = await createCard({
      title: "Card with a next step",
      tags: [],
      sessionId: "session-next-action",
      nextAction: "  Run it  ",
    });

    // Then the card carries that next step, trimmed
    expect(card.nextAction).toBe("Run it");
  });

  it("creates a card without a nextAction, showing no next step", async () => {
    // Given a session that has no next step in mind
    // When it creates a card without a nextAction
    const card = await createCard({
      title: "Card with no next step",
      tags: [],
      sessionId: "session-no-next-action",
    });

    // Then the card shows no next step
    expect(card.nextAction).toBeNull();
  });

  it("treats a whitespace-only nextAction at creation as no next step (D8)", async () => {
    // Given a session that supplies only whitespace as its next step
    // When it creates a card with that whitespace-only nextAction
    const card = await createCard({
      title: "Card with blank next step",
      tags: [],
      sessionId: "session-blank-next-action",
      nextAction: "   ",
    });

    // Then it is trimmed to empty and treated as no next step
    expect(card.nextAction).toBeNull();
  });

  it("adopts the existing in_progress card instead of creating a duplicate for the same session", async () => {
    const db = await getDb();
    await bootstrapIndexes(db);

    // Given a session that already opened a card for its work
    const first = await createCard({
      title: "Investigate flaky test",
      tags: ["backend"],
      sessionId: "session-dupe-guard",
    });

    // When the same session creates again (e.g. after a compact wiped its
    // memory), even under a different title
    const second = await createCard({
      title: "Investigate flaky test (resumed)",
      tags: ["backend"],
      sessionId: "session-dupe-guard",
    });

    // Then it adopts the one card already in progress — no second row
    expect(second.id).toBe(first.id);
    expect(second.number).toBe(first.number);

    const openForSession = await cardsCollection(db)
      .find({ sessionId: "session-dupe-guard", status: Status.InProgress })
      .toArray();
    expect(openForSession).toHaveLength(1);
  });

  it("opens a distinct new card on forceNew, and later plain creates adopt the newest", async () => {
    const db = await getDb();
    await bootstrapIndexes(db);

    // Given a session already working a card
    const base = await createCard({
      title: "Original task",
      tags: ["backend"],
      sessionId: "session-diverge",
    });

    // When the work splits into a genuinely different task (explicit divergence)
    const diverged = await createCard({
      title: "Different task entirely",
      tags: ["backend"],
      sessionId: "session-diverge",
      forceNew: true,
    });

    // Then a new, distinct card is opened
    expect(diverged.id).not.toBe(base.id);

    // And a later non-divergent create adopts the newest live card, not the base
    const resumed = await createCard({
      title: "Different task (resumed)",
      tags: ["backend"],
      sessionId: "session-diverge",
    });
    expect(resumed.id).toBe(diverged.id);
  });

  it("adopts and resumes a need_review card the session handed off, instead of duplicating", async () => {
    const db = await getDb();
    await bootstrapIndexes(db);

    // Given a session that opened a card and handed it off for review
    const first = await createCard({
      title: "Ship the feature",
      tags: ["backend"],
      sessionId: "session-review",
    });
    await updateTaskStatus(first.id, Status.NeedReview, {
      caller: Caller.Agent,
    });

    // When the same session creates again (a reviewer-driven continuation)
    const second = await createCard({
      title: "Address review feedback",
      tags: ["backend"],
      sessionId: "session-review",
    });

    // Then it adopts the same card and resumes it to in_progress — no duplicate
    expect(second.id).toBe(first.id);
    expect(second.status).toBe(Status.InProgress);

    const forSession = await cardsCollection(db)
      .find({ sessionId: "session-review" })
      .toArray();
    expect(forSession).toHaveLength(1);
  });

  it("adopts and resumes a staled card, instead of duplicating", async () => {
    const db = await getDb();
    await bootstrapIndexes(db);

    // Given a session whose card idled out and was parked in Staled
    const first = await createCard({
      title: "Long-running task",
      tags: ["backend"],
      sessionId: "session-staled",
    });
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(first.id) },
      { $set: { status: Status.Staled } },
    );

    // When the session resumes and creates again
    const second = await createCard({
      title: "Long-running task (resumed)",
      tags: ["backend"],
      sessionId: "session-staled",
    });

    // Then it adopts the same card, resumed to in_progress
    expect(second.id).toBe(first.id);
    expect(second.status).toBe(Status.InProgress);
  });

  it("adopts and resumes a blocked card, instead of duplicating", async () => {
    const db = await getDb();
    await bootstrapIndexes(db);

    // Given a session whose card is blocked waiting on a dependency
    const first = await createCard({
      title: "Blocked on infra",
      tags: ["backend"],
      sessionId: "session-blocked",
    });
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(first.id) },
      {
        $set: {
          status: Status.Blocked,
          blockedUntil: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
    );

    // When the session creates again (the block is resolved / it resumes)
    const second = await createCard({
      title: "Unblocked, continuing",
      tags: ["backend"],
      sessionId: "session-blocked",
    });

    // Then it adopts the same card, resumed to in_progress
    expect(second.id).toBe(first.id);
    expect(second.status).toBe(Status.InProgress);
  });

  it("still lands in_progress and session-tracked when no status is named", async () => {
    // Given a session that names no explicit column at all
    // When it creates a card
    const card = await createCard({
      title: "No status named",
      tags: [],
      sessionId: "session-no-status",
    });

    // Then it defaults to in_progress via the existing session-tracking path
    expect(card.status).toBe(Status.InProgress);
    expect(card.pickedAt).not.toBeNull();
    expect(card.sessionId).toBe("session-no-status");
  });
});

describe("createCard with an explicit non-in_progress status (D12/D14 standalone placements)", () => {
  useTestMongo();

  it("files a standalone card in an idle column, never adopting or tracking a session", async () => {
    // Given an agent filing a card straight into the backlog, with tags and a
    // next step, but no session handle
    const card = await createCard({
      title: "Investigate flaky CI",
      tags: ["backend"],
      nextAction: "Check the last 5 failing runs",
      status: Status.Todo,
    });

    // Then it lands in Todo, idle (never picked up), with no dedupeKey or
    // session — a plain standalone card, not session-tracked
    expect(card.status).toBe(Status.Todo);
    expect(card.pickedAt).toBeNull();
    expect(card.sessionId).toBeNull();
    expect(card.tags).toEqual(["backend"]);
    expect(card.nextAction).toBe("Check the last 5 failing runs");

    const db = await getDb();
    const doc = await cardsCollection(db).findOne({
      _id: new ObjectId(card.id),
    });
    expect(doc?.runState).toBe(RunState.Idle);
    expect(doc?.dedupeKey).toBeNull();
    expect(doc && "sessionId" in doc).toBe(false);
  });

  it("files a card already-done, stamping it finished immediately", async () => {
    // Given an agent filing a card that's already complete
    // When it creates the card with status "done"
    const card = await createCard({
      title: "Already-finished chore",
      tags: [],
      status: Status.Done,
    });

    // Then it lands Done, finished now — not an idle placement waiting to be
    // picked up
    expect(card.status).toBe(Status.Done);
    expect(card.finishedAt).not.toBeNull();
  });

  it("files a card already-blocked, starting the board-default countdown", async () => {
    // Given an agent filing a card that's already blocked on something
    // When it creates the card with status "blocked" (no interval to pick — a
    // create carries no `intervalMs` param)
    const card = await createCard({
      title: "Blocked on infra from the start",
      tags: [],
      status: Status.Blocked,
    });

    // Then it lands Blocked with the board-default countdown running, exactly
    // like a fresh move into Blocked with no explicit interval
    expect(card.status).toBe(Status.Blocked);
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    expect(card.blockInterval).toBe(TWO_HOURS_MS);
    const deadlineMs = new Date(card.blockedUntil as string).getTime();
    expect(Math.abs(deadlineMs - (Date.now() + TWO_HOURS_MS))).toBeLessThan(
      60_000,
    );
  });

  it("rejects an unrecognized status value as a readable validation error (D11)", async () => {
    // Given an agent filing a card with a status outside the Status enum
    // When it creates the card
    // Then it is rejected as a validation error, not a raw parser exception
    await expect(
      createCard({
        title: "Bad status card",
        tags: [],
        status: "bogus" as Status,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.Validation });
  });

  it("writes no card when the status value is unrecognized (Step 8 gap)", async () => {
    // Given the current count of cards in the collection
    const db = await getDb();
    const countBefore = await cardsCollection(db).countDocuments({});

    // When an agent files a card with a status outside the Status enum
    // Then the rejection is validation-only — no card is left behind
    await expect(
      createCard({
        title: "Bad status card, take two",
        tags: [],
        status: "bogus" as Status,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.Validation });

    const countAfter = await cardsCollection(db).countDocuments({});
    expect(countAfter).toBe(countBefore);
  });

  it("never touches or duplicates the session's active card when filed standalone under the same sessionId (D14 branch order)", async () => {
    const db = await getDb();
    await bootstrapIndexes(db);

    // Given a session with a live in_progress card
    const original = await createCard({
      title: "Session's live work",
      tags: ["backend"],
      sessionId: "S",
    });
    expect(original.status).toBe(Status.InProgress);

    // When the same session also files a standalone todo card
    const standalone = await createCard({
      title: "Filed backlog item",
      tags: [],
      status: Status.Todo,
      sessionId: "S",
    });

    // Then the session's original card is unchanged
    const reloaded = await cardsCollection(db).findOne({
      _id: new ObjectId(original.id),
    });
    expect(reloaded?.status).toBe(Status.InProgress);
    expect(reloaded?._id.toHexString()).toBe(original.id);

    // And the new card is session-less, not adopted/tracked
    expect(standalone.sessionId).toBeNull();
    expect(standalone.status).toBe(Status.Todo);
    const standaloneDoc = await cardsCollection(db).findOne({
      _id: new ObjectId(standalone.id),
    });
    expect(standaloneDoc?.dedupeKey).toBeNull();

    // And an exact sessionId query returns only the original — no duplicate,
    // no resumed/adopted standalone
    const forSession = await cardsCollection(db)
      .find({ sessionId: "S" })
      .toArray();
    expect(forSession).toHaveLength(1);
    expect(forSession[0]?._id.toHexString()).toBe(original.id);
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
      number: await nextNumber(db, "cards"),
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

describe("listCards", () => {
  useTestMongo();

  it("returns a compact per-card summary with a long description shortened", async () => {
    // Given a card with a next step and a description over the 200-char cutoff
    const longDescription = "x".repeat(250);
    const created = await createCard({
      title: "Survey me",
      description: longDescription,
      tags: [],
      sessionId: "session-survey",
      nextAction: "Ship it",
    });

    // When the board is surveyed
    const card = (await listCards()).find((c) => c.id === created.id);

    // Then the summary carries only the lean fields, with the description
    // shortened to 200 characters plus an ellipsis
    expect(card).toEqual({
      id: created.id,
      number: created.number,
      title: "Survey me",
      status: Status.InProgress,
      nextAction: "Ship it",
      description: `${"x".repeat(200)}…`,
    });
  });

  it("reconciles an expired-blocked card to need_review before surveying (D6)", async () => {
    // Given a card blocked with a deadline that has already passed
    const card = await createTask({
      title: "overdue block",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(card.id, Status.Blocked, { intervalMs: 60_000 });
    const db = await getDb();
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(card.id) },
      { $set: { blockedUntil: new Date(Date.now() - 1000) } },
    );

    // When the board is surveyed
    const surveyed = await listCards();

    // Then the survey reads it as needing review, and the reconcile actually
    // persisted the status change (not just the survey's own view of it)
    const found = surveyed.find((c) => c.id === card.id);
    expect(found?.status).toBe(Status.NeedReview);
    const persisted = await getTask(card.id);
    expect(persisted.status).toBe(Status.NeedReview);
  });

  it("hides finished and archived cards from the default survey", async () => {
    // Given a done card and an archived card
    const doneCard = await createTask({
      title: "will finish",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(doneCard.id, Status.Done);
    const archivedCard = await createTask({
      title: "will archive",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(archivedCard.id, Status.Archived);

    // When the board is surveyed with no status filter
    const surveyed = await listCards();

    // Then neither the done nor the archived card appears
    expect(surveyed.some((c) => c.id === doneCard.id)).toBe(false);
    expect(surveyed.some((c) => c.id === archivedCard.id)).toBe(false);
  });

  it("narrows the survey to exactly the named statuses, overriding the default exclusion (Step 6)", async () => {
    // Given a todo card and a done card (done is excluded by default)
    const todoCard = await createTask({
      title: "stays todo",
      origin: { type: OriginType.Manual },
    });
    const doneCard = await createTask({
      title: "finished",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(doneCard.id, Status.Done);

    // When surveyed with an explicit status filter naming only Done
    const surveyed = await listCards({ status: [Status.Done] });

    // Then only the done card is returned — the explicit filter overrides the
    // default exclusion rather than being ANDed with it
    expect(surveyed.some((c) => c.id === todoCard.id)).toBe(false);
    expect(surveyed.some((c) => c.id === doneCard.id)).toBe(true);
    expect(surveyed.every((c) => c.status === Status.Done)).toBe(true);
  });

  it("treats an empty status filter as no filter, falling through to the default (D9)", async () => {
    // Given a todo card and a done card (done hidden by default)
    const todoCard = await createTask({
      title: "visible by default",
      origin: { type: OriginType.Manual },
    });
    const doneCard = await createTask({
      title: "hidden by default",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(doneCard.id, Status.Done);

    // When surveyed with an explicitly empty status array
    const surveyed = await listCards({ status: [] });

    // Then it behaves like no filter at all — default exclusion still applies
    expect(surveyed.some((c) => c.id === todoCard.id)).toBe(true);
    expect(surveyed.some((c) => c.id === doneCard.id)).toBe(false);
  });

  it("narrows the survey to cards carrying any of the named tags (Step 7)", async () => {
    // Given a card tagged "backend" and a card tagged "frontend"
    const backendCard = await createCard({
      title: "backend work",
      tags: ["backend"],
      sessionId: "session-tags-backend",
    });
    const frontendCard = await createCard({
      title: "frontend work",
      tags: ["frontend"],
      sessionId: "session-tags-frontend",
    });

    // When surveyed with a tags filter naming only "backend"
    const surveyed = await listCards({ tags: ["backend"] });

    // Then only the backend-tagged card is returned
    expect(surveyed.some((c) => c.id === backendCard.id)).toBe(true);
    expect(surveyed.some((c) => c.id === frontendCard.id)).toBe(false);
  });

  it("treats an empty tags filter as no filter, returning all like no filter (D9)", async () => {
    // Given a tagged card
    const taggedCard = await createCard({
      title: "tagged work",
      tags: ["backend"],
      sessionId: "session-tags-empty",
    });

    // When surveyed with an explicitly empty tags array
    const surveyed = await listCards({ tags: [] });

    // Then it behaves like no filter at all — the card is still returned
    expect(surveyed.some((c) => c.id === taggedCard.id)).toBe(true);
  });

  it("lists the most recently touched cards first", async () => {
    // Given three cards with distinct, explicit updatedAt timestamps
    const oldest = await createTask({
      title: "oldest",
      origin: { type: OriginType.Manual },
    });
    const middle = await createTask({
      title: "middle",
      origin: { type: OriginType.Manual },
    });
    const newest = await createTask({
      title: "newest",
      origin: { type: OriginType.Manual },
    });
    const db = await getDb();
    const now = Date.now();
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(oldest.id) },
      { $set: { updatedAt: new Date(now - 3000) } },
    );
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(middle.id) },
      { $set: { updatedAt: new Date(now - 2000) } },
    );
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(newest.id) },
      { $set: { updatedAt: new Date(now - 1000) } },
    );

    // When the board is surveyed
    const surveyed = await listCards();
    const ids = surveyed
      .map((c) => c.id)
      .filter((id) => [oldest.id, middle.id, newest.id].includes(id));

    // Then they come back most-recently-touched first
    expect(ids).toEqual([newest.id, middle.id, oldest.id]);
  });

  it("caps the survey to the requested limit (Step 8)", async () => {
    // Given three cards
    await createTask({ title: "one", origin: { type: OriginType.Manual } });
    await createTask({ title: "two", origin: { type: OriginType.Manual } });
    await createTask({ title: "three", origin: { type: OriginType.Manual } });

    // When surveyed with a limit smaller than the seeded count
    const surveyed = await listCards({ limit: 2 });

    // Then only the limit count comes back
    expect(surveyed).toHaveLength(2);
  });

  it("floors a limit of 0 to 1 rather than returning unbounded results (D11)", async () => {
    // Given two visible cards
    await createTask({ title: "one", origin: { type: OriginType.Manual } });
    await createTask({ title: "two", origin: { type: OriginType.Manual } });

    // When surveyed with an internal-caller limit of 0 (the MCP schema
    // rejects <=0, but an internal caller bypassing it could still pass 0 —
    // and Mongo's own `.limit(0)` means unbounded)
    const surveyed = await listCards({ limit: 0 });

    // Then the floor kicks in: at most 1 card, never the unbounded set
    expect(surveyed.length).toBeLessThanOrEqual(1);
  });

  it("clamps a limit above 200 rather than honoring it (D11)", async () => {
    // Given more than 200 cards, seeded directly for speed
    const db = await getDb();
    const now = new Date();
    // Reserve the whole 205-number range up front so a concurrent nextNumber
    // call can never land inside it — advancing by 1 and consuming 205 would
    // leave the counter behind the last number this seed actually used.
    const base = await nextNumber(db, "cards");
    await countersCollection(db).updateOne(
      { _id: "cards" },
      { $inc: { seq: 204 } },
    );
    const docs: CardDocument[] = Array.from({ length: 205 }, (_, i) => ({
      _id: new ObjectId(),
      number: base + i,
      title: `bulk ${i}`,
      status: Status.Todo,
      priority: 0,
      origin: { type: OriginType.Manual as const },
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
      blockedUntil: null,
      blockInterval: null,
      workspacePath: null,
      repos: [],
    }));
    await cardsCollection(db).insertMany(docs);

    // When surveyed with a limit above the 200 hard cap
    const surveyed = await listCards({ limit: 300 });

    // Then at most 200 come back — the cap wins, not the requested limit
    expect(surveyed).toHaveLength(200);
  });
});

// Own describe (own useTestMongo instance): keeps this block's explicit
// bootstrapIndexes calls and search-specific seeds isolated from the sibling
// "listCards" describe's own seeds (including its 205-card bulk insert for
// the D11 clamp test) — each describe gets its own replica set.
describe("listCards text search", () => {
  useTestMongo();
  clearCollectionsEachTest();

  it("finds cards by a keyword in the title or description", async () => {
    // Given the text index (not auto-run by useTestMongo — see D5) and three
    // cards: one matching by title, one by description, one matching neither
    const db = await getDb();
    await bootstrapIndexes(db);

    const byTitle = await createTask({
      title: "Refactor the marmalade pipeline",
      origin: { type: OriginType.Manual },
    });
    const byDescription = await createTask({
      title: "Unrelated title",
      description: "Needs a marmalade taste test before shipping",
      origin: { type: OriginType.Manual },
    });
    const noMatch = await createTask({
      title: "Completely different work",
      origin: { type: OriginType.Manual },
    });

    // When surveyed with a keyword search
    const surveyed = await listCards({ text: "marmalade" });
    const ids = surveyed.map((c) => c.id);

    // Then both title and description matches return, and the non-match doesn't
    expect(ids).toContain(byTitle.id);
    expect(ids).toContain(byDescription.id);
    expect(ids).not.toContain(noMatch.id);
  });

  it("treats an empty/whitespace text filter as no filter, returning all like no filter (D9)", async () => {
    // Given the text index and a card that would need the $text clause to match
    const db = await getDb();
    await bootstrapIndexes(db);

    const card = await createTask({
      title: "whitespace text filter check",
      origin: { type: OriginType.Manual },
    });

    // When surveyed with a whitespace-only text filter
    const surveyed = await listCards({ text: "   " });

    // Then it behaves like no filter at all — the card is still returned
    expect(surveyed.some((c) => c.id === card.id)).toBe(true);
  });

  it("ranks the best keyword match first even when it is not the most recently touched", async () => {
    // Given the text index and two matching cards: one touched just now but
    // matching the keyword once, one touched long ago but matching it several
    // times across title and description
    const db = await getDb();
    await bootstrapIndexes(db);

    const weakButRecent = await createTask({
      title: "marmalade notes",
      origin: { type: OriginType.Manual },
    });
    const strongButOld = await createTask({
      title: "marmalade marmalade marmalade pipeline",
      description: "marmalade marmalade",
      origin: { type: OriginType.Manual },
    });
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(strongButOld.id) },
      { $set: { updatedAt: new Date(Date.now() - 60_000) } },
    );

    // When surveyed with a keyword search
    const surveyed = await listCards({ text: "marmalade" });
    const ids = surveyed.map((c) => c.id);

    // Then both matches are present (a vacuous pass if the stronger one fell
    // out of the result set is exactly the regression this test guards
    // against) and the stronger match comes back first despite being older
    expect(ids).toContain(strongButOld.id);
    expect(ids).toContain(weakButRecent.id);
    expect(ids.indexOf(strongButOld.id)).toBeLessThan(
      ids.indexOf(weakButRecent.id),
    );
  });

  it("breaks a tie between identically-scoring matches by recency, deterministically", async () => {
    // Given two cards with identical title text (so $text scores them the
    // same) and different updatedAt times
    const db = await getDb();
    await bootstrapIndexes(db);

    const older = await createTask({
      title: "tiebreak marmalade batch",
      origin: { type: OriginType.Manual },
    });
    const newer = await createTask({
      title: "tiebreak marmalade batch",
      origin: { type: OriginType.Manual },
    });
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(older.id) },
      { $set: { updatedAt: new Date(Date.now() - 60_000) } },
    );

    // When surveyed with a keyword search, twice
    const first = (await listCards({ text: "marmalade" })).map((c) => c.id);
    const second = (await listCards({ text: "marmalade" })).map((c) => c.id);

    // Then the tie resolves to recency order, the same way every time
    expect(first).toEqual([newer.id, older.id]);
    expect(second).toEqual(first);
  });

  it("matches a hyphenated ticket id as an OR of its halves, and only the exact id when phrase-quoted", async () => {
    // Given the text index and four cards: the exact ticket id, one that only
    // shares the "rise" half, one that only shares the "14881" half, and one
    // that shares neither
    const db = await getDb();
    await bootstrapIndexes(db);

    const exact = await createTask({
      title: "RISE-14881 supplier profile scoping",
      origin: { type: OriginType.Manual },
    });
    const risePartial = await createTask({
      title: "The rise of the machines",
      origin: { type: OriginType.Manual },
    });
    const numberPartial = await createTask({
      title: "Ticket 14881 follow-up",
      origin: { type: OriginType.Manual },
    });
    const unrelated = await createTask({
      title: "Completely unrelated work",
      origin: { type: OriginType.Manual },
    });

    // When searched unquoted, Then the hyphen tokenises into an OR of "rise"
    // and "14881" — both partial matches return, the exact id returns, the
    // unrelated card does not
    const unquoted = await listCards({ text: "RISE-14881" });
    const unquotedIds = unquoted.map((c) => c.id);
    expect(unquotedIds).toContain(exact.id);
    expect(unquotedIds).toContain(risePartial.id);
    expect(unquotedIds).toContain(numberPartial.id);
    expect(unquotedIds).not.toContain(unrelated.id);

    // When searched phrase-quoted, Then only the card carrying the whole id matches
    const quoted = await listCards({ text: '"RISE-14881"' });
    const quotedIds = quoted.map((c) => c.id);
    expect(quotedIds).toEqual([exact.id]);
  });

  it("reaches finished and archived work without the caller asking for it", async () => {
    // Given matching cards parked in the two statuses a plain listing hides
    const db = await getDb();
    await bootstrapIndexes(db);

    const finished = await createTask({
      title: "quenelle supplier scoping",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(finished.id, Status.Done, {
      caller: Caller.Agent,
    });
    const shelved = await createTask({
      title: "quenelle rollout plan",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(shelved.id, Status.Archived, {
      caller: Caller.Agent,
    });

    // When the keyword is searched with no status filter named
    const searched = await listCards({ text: "quenelle" });

    // Then both come back — a search that hides done work would miss exactly
    // the cards it exists to find, and the agent would open a duplicate
    const ids = searched.map((c) => c.id);
    expect(ids).toContain(finished.id);
    expect(ids).toContain(shelved.id);
  });

  it("still lets an explicit status filter narrow a keyword search", async () => {
    // Given two cards matching the same keyword, one open and one finished
    const db = await getDb();
    await bootstrapIndexes(db);

    const open = await createTask({
      title: "sarsaparilla intake form",
      origin: { type: OriginType.Manual },
    });
    const finished = await createTask({
      title: "sarsaparilla retro",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(finished.id, Status.Done, {
      caller: Caller.Agent,
    });

    // When the caller searches AND names the statuses they want
    const searched = await listCards({
      text: "sarsaparilla",
      status: [Status.Todo],
    });

    // Then the named filter wins over the search's all-status reach
    const ids = searched.map((c) => c.id);
    expect(ids).toEqual([open.id]);
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

  it("lets the agent jump straight todo -> done (any-to-any parity with the UI)", async () => {
    // Given a fresh todo card
    const card = await createTask({
      title: "agent jumps the queue",
      origin: { type: OriginType.Manual },
    });

    // When the agent moves it directly to done (full parity with the human UI)
    const done = await updateTaskStatus(card.id, Status.Done, {
      caller: Caller.Agent,
    });

    // Then it succeeds and stamps finishedAt
    expect(done.status).toBe(Status.Done);
    expect(done.finishedAt).not.toBeNull();
  });

  it("lets the agent resume a parked (stale) card back into progress", async () => {
    // Given a card an agent started that has since been parked in Staled
    const card = await createCard({
      title: "resume me",
      tags: [],
      sessionId: "session-1",
    });
    const db = await getDb();
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(card.id) },
      { $set: { status: Status.Staled } },
    );

    // When the agent resumes it along the legal staled -> in_progress edge
    const resumed = await updateTaskStatus(card.id, Status.InProgress, {
      caller: Caller.Agent,
    });

    // Then the card is back in progress
    expect(resumed.status).toBe(Status.InProgress);
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

  it("records an audited Success event for an agent's in_progress -> in_progress self-move (R7)", async () => {
    // Given a card already in_progress
    const card = await createTask({
      title: "self move me",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(card.id, Status.InProgress);

    // When the agent moves it to the SAME status (a self-move, from==to)
    const selfMoved = await updateTaskStatus(card.id, Status.InProgress, {
      caller: Caller.Agent,
    });

    // Then it succeeds and is recorded as an audited Success event with
    // from==to — the event model has no from!==to guard
    expect(selfMoved.status).toBe(Status.InProgress);
    const events = await listCardEvents(card.id);
    const selfMoveEvent = events.find(
      (event) =>
        event.kind === CardEventKind.StatusTransition &&
        event.from === Status.InProgress &&
        event.to === Status.InProgress,
    );
    expect(selfMoveEvent).toMatchObject({
      outcome: EventOutcome.Success,
      caller: Caller.Agent,
    });
  });

  it("leaves pickedAt null on a bypass move that never enters in_progress (R21)", async () => {
    // Given a fresh todo card that has never been picked up
    const card = await createTask({
      title: "never picked up",
      origin: { type: OriginType.Manual },
    });
    expect(card.pickedAt).toBeNull();

    // When the agent moves it directly todo -> need_review, bypassing
    // in_progress entirely
    const moved = await updateTaskStatus(card.id, Status.NeedReview, {
      caller: Caller.Agent,
    });

    // Then pickedAt is still null — the pickedAt side effect only fires on a
    // move INTO in_progress, which this move never touches
    expect(moved.status).toBe(Status.NeedReview);
    expect(moved.pickedAt).toBeNull();
  });
});

/**
 * A valid CardDocument for the collision/force tests, overridable per field.
 * These tests share one DB (no per-test wipe), so each caller passes a unique
 * `number` and `dedupeKey`; the stale-holder vs live-holder pairs then differ
 * only in `status` and `finishedAt`.
 */
function makeCard(overrides: Partial<CardDocument> = {}): CardDocument {
  const now = new Date();
  return {
    _id: new ObjectId(),
    number: 1,
    title: "card",
    status: Status.InProgress,
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
    pickedAt: now,
    finishedAt: null,
    workspacePath: null,
    repos: [],
    ...overrides,
  };
}

describe("updateTaskStatus dedupeKey collision", () => {
  useTestMongo();

  it("refuses reviving a stale card into a slot an open card already holds (D13)", async () => {
    // Given an imported card that is done but still carries its import
    // dedupeKey, and a live open card (in_progress) re-imported under that
    // same key — both can coexist because `done` sits outside
    // OPEN_STATUSES, so the partial-unique index doesn't see a collision yet
    const db = await getDb();
    await bootstrapIndexes(db);
    const staleDone = makeCard({
      number: 1,
      status: Status.Done,
      dedupeKey: "notion:collide",
      finishedAt: new Date(),
    });
    const liveOpen = makeCard({
      number: 2,
      status: Status.InProgress,
      dedupeKey: "notion:collide",
    });
    await cardsCollection(db).insertMany([staleDone, liveOpen]);

    // When the agent revives the stale card back into in_progress (legal
    // any->any since Step 1) — its dedupeKey now collides with the live card's
    await expect(
      updateTaskStatus(staleDone._id.toHexString(), Status.InProgress, {
        caller: Caller.Agent,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.Duplicate });
  });

  it("with force, displaces the current open holder and the revived card takes over the identity (D13)", async () => {
    // Given the same colliding pair: a stale done card and a live open card
    // sharing one import dedupeKey
    const db = await getDb();
    await bootstrapIndexes(db);
    const staleDone = makeCard({
      number: 3,
      status: Status.Done,
      dedupeKey: "notion:collide-force",
      finishedAt: new Date(),
    });
    const liveOpen = makeCard({
      number: 4,
      status: Status.InProgress,
      dedupeKey: "notion:collide-force",
    });
    await cardsCollection(db).insertMany([staleDone, liveOpen]);

    // When the agent revives the stale card with force:true
    const revived = await updateTaskStatus(
      staleDone._id.toHexString(),
      Status.InProgress,
      { caller: Caller.Agent, force: true },
    );

    // Then the move succeeds and the revived card takes over the identity
    expect(revived.status).toBe(Status.InProgress);
    const revivedDoc = await cardsCollection(db).findOne({
      _id: staleDone._id,
    });
    expect(revivedDoc?.dedupeKey).toBe("notion:collide-force");

    // And the previously-open holder is displaced (dedupeKey cleared)
    const displacedDoc = await cardsCollection(db).findOne({
      _id: liveOpen._id,
    });
    expect(displacedDoc?.dedupeKey).toBeNull();

    // And exactly one open card now carries the key — no lingering duplicate
    const openHolders = await cardsCollection(db)
      .find({
        dedupeKey: "notion:collide-force",
        status: { $in: [Status.Todo, Status.InProgress, Status.NeedReview] },
      })
      .toArray();
    expect(openHolders).toHaveLength(1);
    expect(openHolders[0]?._id).toEqual(staleDone._id);
  });

  it("records a Failure card-event on the attempted card when a collision is rejected without force (D16/D19)", async () => {
    // Given the same colliding pair as the no-force rejection test above
    const db = await getDb();
    await bootstrapIndexes(db);
    const staleDone = makeCard({
      number: 5,
      status: Status.Done,
      dedupeKey: "notion:collide-audit",
      finishedAt: new Date(),
    });
    const liveOpen = makeCard({
      number: 6,
      status: Status.InProgress,
      dedupeKey: "notion:collide-audit",
    });
    await cardsCollection(db).insertMany([staleDone, liveOpen]);

    // When the agent revives the stale card without force, colliding as before
    await expect(
      updateTaskStatus(staleDone._id.toHexString(), Status.InProgress, {
        caller: Caller.Agent,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.Duplicate });

    // Then exactly one Failure event is recorded on the ATTEMPTED card (not the
    // holder) — asserting the count guards against a future double-emit.
    const events = await listCardEvents(staleDone._id.toHexString());
    const failureEvents = events.filter(
      (event) => event.outcome === EventOutcome.Failure,
    );
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0]).toMatchObject({
      kind: CardEventKind.StatusTransition,
      from: Status.Done,
      to: Status.InProgress,
      caller: Caller.Agent,
      outcome: EventOutcome.Failure,
      error: { code: ErrorCode.Duplicate },
    });
  });

  it("records a same-status Success card-event on the displaced holder when force clears its dedupeKey (D16/D19)", async () => {
    // Given the same colliding pair as the force-displacement test above
    const db = await getDb();
    await bootstrapIndexes(db);
    const staleDone = makeCard({
      number: 7,
      status: Status.Done,
      dedupeKey: "notion:collide-force-audit",
      finishedAt: new Date(),
    });
    const liveOpen = makeCard({
      number: 8,
      status: Status.InProgress,
      dedupeKey: "notion:collide-force-audit",
    });
    await cardsCollection(db).insertMany([staleDone, liveOpen]);

    // When the agent revives the stale card with force:true
    await updateTaskStatus(staleDone._id.toHexString(), Status.InProgress, {
      caller: Caller.Agent,
      force: true,
    });

    // Then the displaced holder gets exactly one same-status Success event
    // recording that its dedupeKey was cleared (from/to unchanged — its status)
    const holderEvents = await listCardEvents(liveOpen._id.toHexString());
    const displacementEvents = holderEvents.filter(
      (event) => event.outcome === EventOutcome.Success,
    );
    expect(displacementEvents).toHaveLength(1);
    expect(displacementEvents[0]).toMatchObject({
      kind: CardEventKind.StatusTransition,
      from: Status.InProgress,
      to: Status.InProgress,
      caller: Caller.Agent,
      outcome: EventOutcome.Success,
      error: null,
    });
  });

  it("attributes the displacement event to the caller that forced it, not always the agent", async () => {
    // Given the same colliding pair, but the force comes from the human UI
    const db = await getDb();
    await bootstrapIndexes(db);
    const staleDone = makeCard({
      number: 13,
      status: Status.Done,
      dedupeKey: "notion:collide-force-ui",
      finishedAt: new Date(),
    });
    const liveOpen = makeCard({
      number: 14,
      status: Status.InProgress,
      dedupeKey: "notion:collide-force-ui",
    });
    await cardsCollection(db).insertMany([staleDone, liveOpen]);

    // When a person on the webview revives the stale card with force:true
    await updateTaskStatus(staleDone._id.toHexString(), Status.InProgress, {
      caller: Caller.Ui,
      force: true,
    });

    // Then the holder's displacement is audited as a UI action — an audit log
    // that always says "agent" can't answer who actually displaced the card.
    const holderEvents = await listCardEvents(liveOpen._id.toHexString());
    const displacementEvents = holderEvents.filter(
      (event) => event.outcome === EventOutcome.Success,
    );
    expect(displacementEvents).toHaveLength(1);
    expect(displacementEvents[0]).toMatchObject({
      caller: Caller.Ui,
      outcome: EventOutcome.Success,
    });
  });

  it("rolls the displacement back when the forced retry fails for a non-duplicate reason (MUST FIX)", async () => {
    // Given the colliding pair, but the stale card is stored with a corrupt
    // field (priority as a string) — so the FORCED retry's write succeeds yet
    // its post-image fails schema validation, throwing a non-duplicate
    // SchemaDrift error after the holder has already been displaced.
    const db = await getDb();
    await bootstrapIndexes(db);
    const staleDone = makeCard({
      number: 9,
      status: Status.Done,
      dedupeKey: "notion:retry-rollback",
      finishedAt: new Date(),
    });
    const liveOpen = makeCard({
      number: 10,
      status: Status.InProgress,
      dedupeKey: "notion:retry-rollback",
    });
    // Corrupt the mover so the retry's returned image fails cardDocumentSchema.
    const corruptStale = { ...staleDone, priority: "not-a-number" };
    await cardsCollection(db).insertOne(corruptStale as never);
    await cardsCollection(db).insertOne(liveOpen);

    // When the agent force-revives it, the retry throws SchemaDrift (not a
    // duplicate) — a plain non-transactional sequence would leave the holder
    // stripped of its key with no move applied.
    await expect(
      updateTaskStatus(staleDone._id.toHexString(), Status.InProgress, {
        caller: Caller.Agent,
        force: true,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.SchemaDrift });

    // Then the transaction rolled back: the holder still owns its dedupeKey and
    // the mover never left Done — the one-live-card invariant is intact.
    const holderDoc = await cardsCollection(db).findOne({ _id: liveOpen._id });
    expect(holderDoc?.dedupeKey).toBe("notion:retry-rollback");
    const moverDoc = await cardsCollection(db).findOne({ _id: staleDone._id });
    expect(moverDoc?.status).toBe(Status.Done);
  });

  it("surfaces a duplicate and rolls back when the forced retry still collides (D15 cap)", async () => {
    // Given a resolvable collision, but the in-transaction retry move is forced
    // to hit a SECOND E11000 (a defensive branch the partial-unique index makes
    // unreachable in practice — the 3rd findOneAndUpdate is the retry move).
    const db = await getDb();
    await bootstrapIndexes(db);
    const staleDone = makeCard({
      number: 11,
      status: Status.Done,
      dedupeKey: "notion:retry-dup",
      finishedAt: new Date(),
    });
    const liveOpen = makeCard({
      number: 12,
      status: Status.InProgress,
      dedupeKey: "notion:retry-dup",
    });
    await cardsCollection(db).insertMany([staleDone, liveOpen]);

    const original = Collection.prototype.findOneAndUpdate;
    let calls = 0;
    const spy = vi
      .spyOn(Collection.prototype, "findOneAndUpdate")
      .mockImplementation(function (
        this: Collection<CardDocument>,
        ...args: Parameters<typeof original>
      ): ReturnType<typeof original> {
        calls += 1;
        // Calls: 1 = first move attempt (real E11000), 2 = displacement,
        // 3 = the retry move — force it to collide a second time.
        if (calls === 3) {
          return Promise.reject(
            Object.assign(new Error("E11000 duplicate key"), { code: 11000 }),
          );
        }
        return original.apply(this, args);
      });

    try {
      await expect(
        updateTaskStatus(staleDone._id.toHexString(), Status.InProgress, {
          caller: Caller.Agent,
          force: true,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.Duplicate });
    } finally {
      spy.mockRestore();
    }

    // The aborted transaction restores the displaced holder's dedupeKey.
    const holderDoc = await cardsCollection(db).findOne({ _id: liveOpen._id });
    expect(holderDoc?.dedupeKey).toBe("notion:retry-dup");
  });
});
