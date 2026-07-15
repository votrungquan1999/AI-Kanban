import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
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
    const docs: CardDocument[] = Array.from({ length: 205 }, (_, i) => ({
      _id: new ObjectId(),
      number: i + 1,
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

// Own describe (own useTestMongo instance): the sibling "listCards" block's
// Step-8 test bulk-inserts hard-coded card numbers with no unique index built
// yet, which would collide with the `number` unique index bootstrapIndexes
// builds here if run against that same shared instance.
describe("listCards text search", () => {
  useTestMongo();

  it("finds cards by a keyword in the title or description (Step 10)", async () => {
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
});
