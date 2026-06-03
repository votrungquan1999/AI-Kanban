import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { createTask, updateTaskStatus } from "@/cards/card.service";
import { OriginType, Status } from "@/cards/card.type";
import { emitFieldEditEvent, listCardEvents } from "@/cards/card-event.service";
import {
  CardEventKind,
  EditableField,
  EventOutcome,
  type StatusTransitionEventDocument,
} from "@/cards/card-event.type";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardEventsCollection } from "@/db/collections";
import { bootstrapIndexes } from "@/db/indexes";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

describe("card events — create", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await cardEventsCollection(db).deleteMany({});
  });

  it("writes one success event with from=null and to=todo when a card is created", async () => {
    // Given a freshly created card
    const db = await getDb();
    const card = await createTask({
      title: "Audited create",
      origin: { type: OriginType.Manual },
    });

    // When reading that card's events back
    const events = await cardEventsCollection(db)
      .find({ cardId: new ObjectId(card.id) })
      .toArray();

    // Then exactly one create event is recorded
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      from: null,
      to: Status.Todo,
      caller: Caller.Ui,
      outcome: EventOutcome.Success,
      error: null,
    });
    expect(events[0].at).toBeInstanceOf(Date);
  });

  it("does not record a create event when the insert is rejected as a duplicate", async () => {
    // Given indexes and an existing card with a dedupeKey
    const db = await getDb();
    await bootstrapIndexes(db);
    await createTask({
      title: "first",
      origin: { type: OriginType.Manual },
      dedupeKey: "notion:dup",
    });

    // When a second create with the same dedupeKey is rejected
    await expect(
      createTask({
        title: "second",
        origin: { type: OriginType.Manual },
        dedupeKey: "notion:dup",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.Duplicate });

    // Then only the first create left an event (the failed insert emitted none)
    const total = await cardEventsCollection(db).countDocuments({});
    expect(total).toBe(1);
  });
});

describe("card events — transition", () => {
  useTestMongo();

  it("writes one success event carrying caller and from→to on a successful move", async () => {
    // Given a todo card
    const db = await getDb();
    const card = await createTask({
      title: "Audited move",
      origin: { type: OriginType.Manual },
    });

    // When the UI moves it todo -> in_progress
    await updateTaskStatus(card.id, Status.InProgress);

    // Then a success transition event with the before/after statuses is recorded
    const events = await cardEventsCollection(db)
      .find({ cardId: new ObjectId(card.id) })
      .toArray();
    expect(events).toHaveLength(2);
    const transition = events.find(
      (e) =>
        e.kind === CardEventKind.StatusTransition && e.to === Status.InProgress,
    );
    expect(transition).toMatchObject({
      from: Status.Todo,
      to: Status.InProgress,
      caller: Caller.Ui,
      outcome: EventOutcome.Success,
      error: null,
    });
  });
});

describe("card events — failure", () => {
  useTestMongo();

  it("records a failure event with the error code on an illegal transition", async () => {
    // Given a todo card
    const db = await getDb();
    const card = await createTask({
      title: "Illegal move",
      origin: { type: OriginType.Manual },
    });

    // When the agent attempts the illegal todo -> done edge (rejected)
    await expect(
      updateTaskStatus(card.id, Status.Done, { caller: Caller.Agent }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidTransition });

    // Then a failure event with the attempted to + error code is recorded
    const events = await cardEventsCollection(db)
      .find({ cardId: new ObjectId(card.id) })
      .toArray();
    const failure = events.find((e) => e.outcome === EventOutcome.Failure);
    expect(failure).toMatchObject({
      from: Status.Todo,
      to: Status.Done,
      caller: Caller.Agent,
      outcome: EventOutcome.Failure,
      error: { code: ErrorCode.InvalidTransition },
    });
  });

  it("records a failure event with from=null when the card is missing", async () => {
    // Given an unused id
    const db = await getDb();
    const missingId = new ObjectId();

    // When moving it (rejected as not-found)
    await expect(
      updateTaskStatus(missingId.toHexString(), Status.Done),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });

    // Then a failure event with from=null and the not-found code is recorded
    const events = await cardEventsCollection(db)
      .find({ cardId: missingId })
      .toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      from: null,
      to: Status.Done,
      caller: Caller.Ui,
      outcome: EventOutcome.Failure,
      error: { code: ErrorCode.NotFound },
    });
  });
});

describe("card events — field edits", () => {
  useTestMongo();

  it("writes and reads back a field-edit event carrying its changed fields", async () => {
    // Given a created card
    const db = await getDb();
    const card = await createTask({
      title: "Editable",
      origin: { type: OriginType.Manual },
    });

    // When a field-edit event is recorded for a title + priority change
    await emitFieldEditEvent(db, {
      cardId: new ObjectId(card.id),
      caller: Caller.Ui,
      changes: [
        { field: EditableField.Title, from: "Editable", to: "Edited" },
        { field: EditableField.Priority, from: "0", to: "2" },
      ],
    });

    // Then the timeline read-back includes the field-edit entry with its changes
    const events = await listCardEvents(card.id);
    const edit = events.find((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit).toMatchObject({
      kind: CardEventKind.FieldEdit,
      caller: Caller.Ui,
      outcome: EventOutcome.Success,
      error: null,
      changes: [
        { field: EditableField.Title, from: "Editable", to: "Edited" },
        { field: EditableField.Priority, from: "0", to: "2" },
      ],
    });
  });
});

describe("card events — legacy rows (no migration)", () => {
  useTestMongo();

  it("reads a legacy status row that predates the kind discriminator as a status transition", async () => {
    // Given a legacy card_events row written before the `kind` discriminator
    const db = await getDb();
    const cardId = new ObjectId();
    await db.collection("card_events").insertOne({
      cardId,
      from: Status.Todo,
      to: Status.InProgress,
      caller: Caller.Ui,
      at: new Date(),
      outcome: EventOutcome.Success,
      error: null,
    });

    // When reading that card's timeline back
    const events = await listCardEvents(cardId.toHexString());

    // Then the row parses with no migration, coalesced to a status transition
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: CardEventKind.StatusTransition,
      from: Status.Todo,
      to: Status.InProgress,
      caller: Caller.Ui,
      outcome: EventOutcome.Success,
    });
  });
});

describe("card events — chronological read-back", () => {
  useTestMongo();

  it("returns a card's events oldest-first across its lifecycle", async () => {
    // Given a card taken through create + three successful transitions
    const card = await createTask({
      title: "Timeline",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(card.id, Status.InProgress);
    await updateTaskStatus(card.id, Status.NeedReview, {
      caller: Caller.Agent,
    });
    await updateTaskStatus(card.id, Status.Done, { caller: Caller.Agent });

    // When reading the timeline back
    const events = await listCardEvents(card.id);

    // Then all four events come back in chronological from→to order
    expect(events).toHaveLength(4);
    const transitions = events.filter(
      (e): e is StatusTransitionEventDocument =>
        e.kind === CardEventKind.StatusTransition,
    );
    expect(transitions.map((e) => [e.from, e.to])).toEqual([
      [null, Status.Todo],
      [Status.Todo, Status.InProgress],
      [Status.InProgress, Status.NeedReview],
      [Status.NeedReview, Status.Done],
    ]);
    for (const event of events) {
      expect(event.outcome).toBe(EventOutcome.Success);
    }
  });
});
