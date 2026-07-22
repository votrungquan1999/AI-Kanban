import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createTask, updateTaskStatus } from "@/cards/card.service";
import type { CardDocument } from "@/cards/card.type";
import { OriginType, RunState, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind, EventOutcome } from "@/cards/card-event.type";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { bootstrapIndexes } from "@/db/indexes";
import { getDb } from "@/db/mongo";
import {
  createAppendDecision,
  createClaimCard,
  createCreateCard,
  createGetCardContext,
  createMarkDecisionOutdated,
  createSetStatus,
  createSetWorkspace,
  createUpdateCard,
} from "@/mcp/dispatch-tools";
import { useTestMongo } from "@/test/use-test-mongo";

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

    // Then a session-less standalone todo card comes back
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
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

    // Then the tool succeeds and the card reflects the declared workspace state
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      workspacePath: "workspaces/card-1",
      repos,
    });
  });
});

describe("append_decision handler", () => {
  useTestMongo();

  it("records a decision on a card by id and returns it as success", async () => {
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

    // Then the decision comes back on the card as success structured content
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      decisions: [{ decision: "route the decision through the dispatch tool" }],
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

    // Then the marked card comes back as success structured content
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
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

    // Then the edit persists as success structured content
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
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
