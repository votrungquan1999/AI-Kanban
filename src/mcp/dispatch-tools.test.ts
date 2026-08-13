import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  createCard,
  createTask,
  getTask,
  updateTaskStatus,
} from "@/cards/card.service";
import type { CardDocument } from "@/cards/card.type";
import { CardView, OriginType, RunState, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind, EventOutcome } from "@/cards/card-event.type";
import { nextNumber } from "@/cards/counters";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { bootstrapIndexes } from "@/db/indexes";
import { closeMongo, getDb } from "@/db/mongo";
import {
  createAppendDecision,
  createAppendProgress,
  createClaimCard,
  createCreateCard,
  createGetCardContext,
  createListCards,
  createMarkDecisionOutdated,
  createSetStatus,
  createSetWorkspace,
  createUpdateCard,
} from "@/mcp/dispatch-tools";
import { useTestMongo } from "@/test/use-test-mongo";

/** Mongo's generated name for the title+description text index. */
const TEXT_INDEX_NAME = "title_text_description_text";

/** Mongo's generated name for the partial-unique dedupeKey index. */
const DEDUPE_INDEX_NAME = "dedupeKey_1";

/** The dedupeKey the seeded colliding pair both carry. */
const DUPLICATED_KEY = "session:session-collides";

describe("claim_card handler", () => {
  useTestMongo();

  it("claims a todo card by id and returns it as success, now in progress", async () => {
    // Given a card waiting in Todo
    const created = await createTask({
      title: "claim via tool",
      origin: { type: OriginType.Manual },
    });

    // When the claim tool is invoked with the card's id
    const result = await createClaimCard()({ id: created.id });

    // Then the claimed card comes back as a success result, now in progress
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      status: Status.InProgress,
    });
  });

  it("reports a failed claim as a readable error result without throwing", async () => {
    // Given a card that has already been claimed
    const created = await createTask({
      title: "already taken",
      origin: { type: OriginType.Manual },
    });
    const claim = createClaimCard();
    await claim({ id: created.id });

    // When the same card is claimed again
    const second = await claim({ id: created.id });

    // Then a readable failure result comes back (not a throw)
    expect(second.isError).toBe(true);
    expect(second.content[0]).toMatchObject({ type: "text" });

    // And an unknown id is reported the same readable way (not a throw)
    const unknown = await claim({ id: new ObjectId().toHexString() });
    expect(unknown.isError).toBe(true);
  });
});

describe("create_card handler", () => {
  useTestMongo();

  it("files a standalone todo card when status is given (D12/D14 forwarded from the schema)", async () => {
    // When the create_card tool is invoked with status: todo
    const result = await createCreateCard()({
      title: "backlog via tool",
      tags: [],
      status: Status.Todo,
    });

    // Then the ack names the filed card and its resulting status
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: Status.Todo });

    // And the card itself is session-less — read back via the id the ack
    // carries, because a write acknowledges rather than echoing the card
    const { id } = result.structuredContent as { id: string };
    const context = await createGetCardContext()({ id, view: CardView.Full });
    expect(context.structuredContent).toMatchObject({
      title: "backlog via tool",
      status: Status.Todo,
      sessionId: null,
    });
  });
});

describe("get_card_context handler", () => {
  useTestMongo();

  it("returns a card's task context by id", async () => {
    // Given an existing card
    const created = await createTask({
      title: "read context",
      origin: { type: OriginType.Manual },
    });

    // When the context tool is invoked with that card's id
    const result = await createGetCardContext()({ id: created.id });

    // Then the card's task context comes back as success structured content
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      title: "read context",
      status: Status.Todo,
    });
  });

  it("returns a resume view by default: current decisions with their index, the latest progress note, and counts of what was left out", async () => {
    // Given a card whose first decision has been superseded, and which has
    // collected more than one progress note
    const created = await createTask({
      title: "resume me",
      origin: { type: OriginType.Manual },
    });
    await createAppendDecision()({
      id: created.id,
      decision: "first choice",
      why: "the reason the first one won",
    });
    await createAppendDecision()({
      id: created.id,
      decision: "second choice",
      why: "the reason the second one won",
    });
    await createMarkDecisionOutdated()({
      id: created.id,
      index: 0,
      supersededByIndex: 1,
    });
    await createAppendProgress()({ id: created.id, note: "an early note" });
    await createAppendProgress()({ id: created.id, note: "the latest note" });

    // When a resuming session reads the card
    const result = await createGetCardContext()({ id: created.id });

    // Then it gets what it needs to re-orient, and is told what was withheld
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      title: "resume me",
      status: Status.Todo,
      latestProgress: { note: "the latest note" },
      omitted: { outdatedDecisions: 1, earlierProgress: 1 },
    });

    // And each surviving decision keeps the index mark_decision_outdated
    // addresses it by — filtering the log would otherwise shift every target
    expect(
      (result.structuredContent as { decisions: unknown[] }).decisions,
    ).toEqual([{ index: 1, decision: "second choice" }]);

    // And the reasoning prose stays behind until it is actually asked for
    expect(JSON.stringify(result.structuredContent)).not.toContain(
      "the reason the second one won",
    );
  });

  it("returns the entire card, superseded decisions included, when view is full", async () => {
    // Given a card whose first decision has been superseded
    const created = await createTask({
      title: "full view",
      origin: { type: OriginType.Manual },
    });
    await createAppendDecision()({
      id: created.id,
      decision: "first choice",
      why: "the reason the first one won",
    });
    await createAppendDecision()({ id: created.id, decision: "second choice" });
    await createMarkDecisionOutdated()({
      id: created.id,
      index: 0,
      supersededByIndex: 1,
    });

    // When the caller explicitly asks for the full view
    const result = await createGetCardContext()({
      id: created.id,
      view: CardView.Full,
    });

    // Then it is the card exactly as this read returned it before the resume
    // view existed — every field, both decisions, and their reasoning
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(await getTask(created.id));
  });

  it("returns the decision log with its reasoning, and nothing else, when view is decisions", async () => {
    // Given a card carrying a reasoned decision, a description and a note
    const created = await createTask({
      title: "why lookup",
      description: "a description a resuming session does not need",
      origin: { type: OriginType.Manual },
    });
    await createAppendDecision()({
      id: created.id,
      decision: "the chosen route",
      why: "the reason it beat the alternative",
    });
    await createAppendProgress()({ id: created.id, note: "a progress note" });

    // When the caller follows up on reasoning the resume view withheld
    const result = await createGetCardContext()({
      id: created.id,
      view: CardView.Decisions,
    });

    // Then the why is available without asking for the whole card
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      decisions: [
        {
          index: 0,
          decision: "the chosen route",
          why: "the reason it beat the alternative",
        },
      ],
    });

    // And the rest of the card was not the price of getting it
    const returned = JSON.stringify(result.structuredContent);
    expect(returned).not.toContain(
      "a description a resuming session does not need",
    );
    expect(returned).not.toContain("a progress note");
  });
});

describe("set_status handler", () => {
  useTestMongo();

  it("moves a card to a legal next status by id and records it in the audit log", async () => {
    // Given a card that is in progress (a legal agent source)
    const created = await createTask({
      title: "advance me",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(created.id, Status.InProgress);

    // When the status tool moves it to need_review (a legal agent edge)
    const result = await createSetStatus()({
      id: created.id,
      status: Status.NeedReview,
    });

    // Then the updated card comes back at the new status
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      status: Status.NeedReview,
    });

    // And the change is recorded in the audit log
    const events = await listCardEvents(created.id);
    const moved = events.find(
      (e) =>
        e.kind === CardEventKind.StatusTransition &&
        e.to === Status.NeedReview &&
        e.outcome === EventOutcome.Success,
    );
    expect(moved).toBeDefined();
  });

  it("moves a card along a once-illegal agent edge now that any->any parity applies, and records it", async () => {
    // Given a card still in todo (previously not a legal agent source for done)
    const created = await createTask({
      title: "todo to done directly",
      origin: { type: OriginType.Manual },
    });

    // When the status tool jumps straight todo -> done (any->any parity, Step 1)
    const result = await createSetStatus()({
      id: created.id,
      status: Status.Done,
    });

    // Then the move succeeds and the card lands at done
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      status: Status.Done,
    });

    // And the change is recorded in the audit log
    const events = await listCardEvents(created.id);
    const moved = events.find(
      (e) =>
        e.kind === CardEventKind.StatusTransition &&
        e.to === Status.Done &&
        e.outcome === EventOutcome.Success,
    );
    expect(moved).toBeDefined();
  });

  it("with force:true, displaces the current open holder on a dedupeKey collision (D13)", async () => {
    // Given a session's terminal card (done) that still carries its session
    // dedupeKey, and the SAME session's live open card (in_progress) holding
    // that same key — coexisting because `done` sits outside OPEN_STATUSES
    const db = await getDb();
    await bootstrapIndexes(db);
    const now = new Date();
    const staleDone: CardDocument = {
      _id: new ObjectId(),
      number: 101,
      title: "stale terminal card",
      status: Status.Done,
      priority: 0,
      origin: { type: OriginType.Manual },
      dedupeKey: "session:tool-collide",
      runState: RunState.Idle,
      process: null,
      attempts: 0,
      restarts: 0,
      nextStartAfter: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      pickedAt: now,
      finishedAt: now,
      workspacePath: null,
      repos: [],
    };
    const liveOpen: CardDocument = {
      _id: new ObjectId(),
      number: 102,
      title: "session's live card",
      status: Status.InProgress,
      priority: 0,
      origin: { type: OriginType.Manual },
      dedupeKey: "session:tool-collide",
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
    };
    await cardsCollection(db).insertMany([staleDone, liveOpen]);

    // When the set_status tool revives the stale card with force:true
    const result = await createSetStatus()({
      id: staleDone._id.toHexString(),
      status: Status.InProgress,
      force: true,
    });

    // Then the move succeeds — force overrode the duplicate collision
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: staleDone._id.toHexString(),
      status: Status.InProgress,
    });
  });
});

describe("set_workspace handler", () => {
  useTestMongo();

  it("declares a card's workspace state by id and reflects it on the card", async () => {
    // Given an existing card
    const created = await createTask({
      title: "declare via tool",
      origin: { type: OriginType.Manual },
    });

    // When the workspace tool is invoked with a declaration
    const repos = [
      {
        repo: "repo-a",
        branch: "aikanban/card-1",
        worktreePath: "workspaces/card-1/repo-a",
      },
    ];
    const result = await createSetWorkspace()({
      id: created.id,
      workspacePath: "workspaces/card-1",
      repos,
    });

    // Then the tool succeeds and the card reflects the declared workspace
    // state — read back, because a write acknowledges rather than echoing
    expect(result.isError).toBeUndefined();
    const context = await createGetCardContext()({
      id: created.id,
      view: CardView.Full,
    });
    expect(context.structuredContent).toMatchObject({
      id: created.id,
      workspacePath: "workspaces/card-1",
      repos,
    });
  });
});

describe("append_decision handler", () => {
  useTestMongo();

  it("records a decision on a card by id, readable back from the card context", async () => {
    // Given an existing card
    const created = await createTask({
      title: "record via tool",
      origin: { type: OriginType.Manual },
    });

    // When the append_decision tool is invoked with the card's id
    const result = await createAppendDecision()({
      id: created.id,
      decision: "route the decision through the dispatch tool",
    });

    // Then the tool succeeds and the decision is durably on the card — read
    // back, because a write acknowledges rather than echoing its own entries
    expect(result.isError).toBeUndefined();
    const context = await createGetCardContext()({
      id: created.id,
      view: CardView.Full,
    });
    expect(context.structuredContent).toMatchObject({
      id: created.id,
      decisions: [{ decision: "route the decision through the dispatch tool" }],
    });
  });

  it("acknowledges the append with counts instead of echoing the card's entries", async () => {
    // Given a card that already carries one decision
    const created = await createTask({
      title: "ack not echo",
      origin: { type: OriginType.Manual },
    });
    await createAppendDecision()({
      id: created.id,
      decision: "the first decision",
    });

    // When a second decision is recorded
    const result = await createAppendDecision()({
      id: created.id,
      decision: "the second decision",
    });

    // Then the result identifies the card and counts what it holds, and carries
    // nothing else — so a write cannot cost more as the card grows
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: created.id,
      number: created.number,
      status: Status.Todo,
      decisionCount: 2,
      progressCount: 0,
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify(result.structuredContent),
    });
  });

  it("keeps the acknowledgement flat as the card fills up", async () => {
    // Given a card already carrying long decisions and progress notes
    const created = await createTask({
      title: "fills up",
      origin: { type: OriginType.Manual },
    });
    for (let index = 0; index < 8; index++) {
      await createAppendDecision()({
        id: created.id,
        decision: `wordy decision ${index} here `.repeat(6),
        why: `a wordy reason it beat the alternative `.repeat(8),
      });
      await createAppendProgress()({
        id: created.id,
        note: `a long progress note ${index} `.repeat(8),
      });
    }

    // When one more decision is recorded
    const result = await createAppendDecision()({
      id: created.id,
      decision: "the ninth decision",
    });

    // Then none of the accumulated text comes back — only identity and counts
    expect(result.structuredContent).toEqual({
      id: created.id,
      number: created.number,
      status: Status.Todo,
      decisionCount: 9,
      progressCount: 8,
    });

    // And the write stays cheap regardless of how much the card now holds
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(150);
  });

  it("surfaces an over-long decision to the agent as ERR_VALIDATION carrying the actual length", async () => {
    // Given an existing card
    const created = await createTask({
      title: "too long via tool",
      origin: { type: OriginType.Manual },
    });

    // When the agent records a decision past the limit, Then it reaches the
    // agent as a readable validation error naming the length — the whole point
    // of rejecting is that the agent can rewrite it, not retry it unchanged
    const result = await createAppendDecision()({
      id: created.id,
      decision: "x".repeat(201),
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: ErrorCode.Validation,
      message: expect.stringMatching(/\b201\b.*\b200\b/),
    });
  });

  it("returns a readable error for an unknown id", async () => {
    // When the tool is invoked with an id that does not exist
    const result = await createAppendDecision()({
      id: new ObjectId().toHexString(),
      decision: "does not matter",
    });

    // Then a readable error result comes back (not a throw)
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
});

describe("mark_decision_outdated handler", () => {
  useTestMongo();

  it("marks a card's decision outdated by id and index and returns it as success", async () => {
    // Given an existing card with one recorded decision
    const created = await createTask({
      title: "mark via tool",
      origin: { type: OriginType.Manual },
    });
    await createAppendDecision()({
      id: created.id,
      decision: "route the mark through the dispatch tool",
    });

    // When the mark_decision_outdated tool is invoked with the card's id and index
    const result = await createMarkDecisionOutdated()({
      id: created.id,
      index: 0,
    });

    // Then the tool succeeds and the decision now reads as outdated on the
    // card — read back, because a write acknowledges rather than echoing
    expect(result.isError).toBeUndefined();
    const context = await createGetCardContext()({
      id: created.id,
      view: CardView.Full,
    });
    expect(context.structuredContent).toMatchObject({
      id: created.id,
      decisions: [{ status: "outdated" }],
    });
  });

  it("returns a readable error for an unknown id", async () => {
    // When the tool is invoked with an id that does not exist
    const result = await createMarkDecisionOutdated()({
      id: new ObjectId().toHexString(),
      index: 0,
    });

    // Then a readable error result comes back (not a throw)
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
});

describe("update_card handler", () => {
  useTestMongo();

  it("edits a card by id and records the change with the agent caller", async () => {
    // Given an existing card
    const created = await createTask({
      title: "before edit",
      origin: { type: OriginType.Manual },
    });

    // When the update tool renames it
    const result = await createUpdateCard()({
      id: created.id,
      title: "after edit",
    });

    // Then the edit persists — read back, because a write acknowledges rather
    // than echoing the card
    expect(result.isError).toBeUndefined();
    const context = await createGetCardContext()({
      id: created.id,
      view: CardView.Full,
    });
    expect(context.structuredContent).toMatchObject({
      id: created.id,
      title: "after edit",
    });

    // And the audit trail attributes the change to the agent caller
    const events = await listCardEvents(created.id);
    const edit = events.find((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit?.caller).toBe(Caller.Agent);
  });

  it("returns a readable error for an unknown id", async () => {
    // When the update tool is invoked with an id that does not exist
    const result = await createUpdateCard()({
      id: new ObjectId().toHexString(),
      title: "does not matter",
    });

    // Then a readable error result comes back (not a throw)
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
});

describe("list_cards handler when the board's search index is missing", () => {
  useTestMongo();

  it("returns a readable error for a keyword search instead of an empty board", async () => {
    // Given a board carrying a matching card, whose text index failed to build
    const db = await getDb();
    await createTask({
      title: "searchable card",
      origin: { type: OriginType.Manual },
    });
    await cardsCollection(db).dropIndex(TEXT_INDEX_NAME);

    try {
      // When the agent searches by keyword
      const result = await createListCards()({ text: "searchable" });

      // Then it is told search is unavailable, not handed an empty result it
      // would read as "no such card exists" and duplicate
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: ErrorCode.SearchUnavailable,
      });
    } finally {
      await bootstrapIndexes(db);
    }
  });

  it("never blames an unrelated index failure, nor leaks its key values, for missing search", async () => {
    // Given a board that already holds duplicate open cards under one dedupe
    // key — the production shape that makes the partial-unique index unbuildable
    const db = await getDb();
    await cardsCollection(db).dropIndex(DEDUPE_INDEX_NAME);
    await createCard({
      title: "first holder",
      tags: [],
      sessionId: "session-collides",
    });
    await cardsCollection(db).insertOne({
      ...(await cardsCollection(db).findOne({ dedupeKey: DUPLICATED_KEY })),
      _id: new ObjectId(),
      number: await nextNumber(db, "cards"),
    } as CardDocument);

    // And a fresh connection, so the bootstrap runs against that data and
    // records the failure the way it would on a real cold start
    await closeMongo();
    const reconnected = await getDb();
    await cardsCollection(reconnected).dropIndex(TEXT_INDEX_NAME);

    try {
      // When the agent searches by keyword
      const result = await createListCards()({ text: "holder" });

      // Then the message does NOT pin the blame on dedupeKey, which has
      // nothing to do with search — a wrong cause sends the operator after the
      // wrong problem — and does not paste the colliding key's session id into
      // the agent's context along the way
      expect(result.isError).toBe(true);
      const { message } = result.structuredContent as { message: string };
      expect(message).not.toContain("dedupeKey");
      expect(message).not.toContain("session-collides");
    } finally {
      await closeMongo();
      const clean = await getDb();
      await cardsCollection(clean).deleteMany({});
      await bootstrapIndexes(clean);
    }
  });

  it("still lists the board when the same call drops the keyword, so the agent can fall back", async () => {
    // Given a board whose text index failed to build
    const db = await getDb();
    const created = await createTask({
      title: "still listable",
      origin: { type: OriginType.Manual },
    });
    await cardsCollection(db).dropIndex(TEXT_INDEX_NAME);

    try {
      // When the agent retries without the keyword, as the error told it to
      const result = await createListCards()({});

      // Then the board comes back intact — losing search never costs listing
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        cards: expect.arrayContaining([
          expect.objectContaining({ id: created.id, title: "still listable" }),
        ]),
      });
    } finally {
      await bootstrapIndexes(db);
    }
  });
});
