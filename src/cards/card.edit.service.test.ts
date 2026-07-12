import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteTask, updateTask } from "@/cards/card.edit.service";
import { createCard, createTask, getTask } from "@/cards/card.service";
import { reconcileStaledCards } from "@/cards/card.staled.service";
import { OriginType, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import {
  CardEventKind,
  EditableField,
  EventOutcome,
} from "@/cards/card-event.type";
import { Caller } from "@/cards/transition-policy";
import { cardEventsCollection, cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/** Create an in-progress card and park it in the Staled lane via reconcile. */
async function createStaledCard(title: string): Promise<string> {
  const card = await createCard({ title, tags: [], sessionId: "session-1" });
  const db = await getDb();
  await cardsCollection(db).updateOne(
    { _id: new ObjectId(card.id) },
    { $set: { updatedAt: new Date(Date.now() - THREE_HOURS_MS - 1000) } },
  );
  await reconcileStaledCards();
  return card.id;
}

/** Count system Staled -> InProgress revive events recorded on a card. */
async function countRevives(cardId: string): Promise<number> {
  const events = await listCardEvents(cardId);
  return events.filter(
    (event) =>
      event.kind === CardEventKind.StatusTransition &&
      event.caller === Caller.System &&
      event.from === Status.Staled &&
      event.to === Status.InProgress,
  ).length;
}

describe("updateTask", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await cardsCollection(db).deleteMany({});
    await cardEventsCollection(db).deleteMany({});
  });

  it("patches only the provided fields, leaves the rest untouched, and bumps updatedAt", async () => {
    // Given a card with a title, description, and priority
    const created = await createTask({
      title: "Original",
      description: "old desc",
      origin: { type: OriginType.Manual },
      priority: 1,
    });

    // When editing only the title and priority
    const updated = await updateTask(created.id, {
      title: "Renamed",
      priority: 2,
    });

    // Then those fields change, the description is left intact, and updatedAt advances
    expect(updated.title).toBe("Renamed");
    expect(updated.priority).toBe(2);
    expect(updated.description).toBe("old desc");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it("records a field-edit audit event capturing only the changed fields", async () => {
    // Given a card whose description we will re-supply unchanged
    const created = await createTask({
      title: "Original",
      description: "keep me",
      origin: { type: OriginType.Manual },
      priority: 0,
    });

    // When editing title + priority and re-passing the same description
    await updateTask(created.id, {
      title: "Renamed",
      priority: 2,
      description: "keep me",
    });

    // Then the audit diff lists only the fields that actually changed
    const events = await listCardEvents(created.id);
    const edit = events.find((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit?.kind === CardEventKind.FieldEdit && edit.changes).toEqual([
      { field: EditableField.Title, from: "Original", to: "Renamed" },
      { field: EditableField.Priority, from: "0", to: "2" },
    ]);
  });

  it("bumps updatedAt only for an empty patch and emits no field-edit event", async () => {
    // Given a freshly created card
    const created = await createTask({
      title: "x",
      origin: { type: OriginType.Manual },
    });

    // When applying an empty patch
    const updated = await updateTask(created.id, {});

    // Then updatedAt still advances but no field-edit row is written
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
    const events = await listCardEvents(created.id);
    expect(events.some((e) => e.kind === CardEventKind.FieldEdit)).toBe(false);
  });

  it("clears the description when the patch supplies a blank one", async () => {
    // Given a card that currently has a description
    const created = await createTask({
      title: "Has desc",
      description: "remove me",
      origin: { type: OriginType.Manual },
    });

    // When editing it with a blank description
    const updated = await updateTask(created.id, { description: "" });

    // Then the field is removed, not stored as an empty string
    expect(updated.description).toBeUndefined();
    const reloaded = await getTask(created.id);
    expect(reloaded.description).toBeUndefined();
  });

  it("records the field-edit audit event with the given caller", async () => {
    // Given a card
    const created = await createTask({
      title: "Caller test",
      origin: { type: OriginType.Manual },
    });

    // When editing it as the agent caller
    await updateTask(
      created.id,
      { title: "Renamed by agent" },
      { caller: Caller.Agent },
    );

    // Then the audit row attributes the change to the agent, not the UI default
    const events = await listCardEvents(created.id);
    const edit = events.find((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit?.caller).toBe(Caller.Agent);
  });

  it("does not bump updatedAt or write an audit row for a no-op patch (D7)", async () => {
    // Given a card
    const created = await createTask({
      title: "No-op",
      origin: { type: OriginType.Manual },
    });

    // When re-supplying the same title (nothing actually changes)
    const updated = await updateTask(created.id, { title: "No-op" });

    // Then updatedAt is untouched and no field-edit row is written
    expect(updated.updatedAt).toBe(created.updatedAt);
    const events = await listCardEvents(created.id);
    expect(events.some((e) => e.kind === CardEventKind.FieldEdit)).toBe(false);
  });

  it("sets a card's nextAction on an edit, recording it in history", async () => {
    // Given a card with no next step
    const created = await createTask({
      title: "No next step yet",
      origin: { type: OriginType.Manual },
    });

    // When editing it with a nextAction
    const updated = await updateTask(created.id, { nextAction: "Ship it" });

    // Then the field is set and the audit row records none -> the new value
    expect(updated.nextAction).toBe("Ship it");
    const events = await listCardEvents(created.id);
    const edit = events.find((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit?.kind === CardEventKind.FieldEdit && edit.changes).toEqual([
      { field: EditableField.NextAction, from: null, to: "Ship it" },
    ]);
  });

  it("changes an existing nextAction on an edit, recording it in history", async () => {
    // Given a card with an existing next step
    const created = await updateTask(
      (
        await createTask({
          title: "Has next step",
          origin: { type: OriginType.Manual },
        })
      ).id,
      { nextAction: "Old step" },
    );

    // When editing it with a different nextAction
    const updated = await updateTask(created.id, { nextAction: "New step" });

    // Then the field changes and the audit row records old -> new
    expect(updated.nextAction).toBe("New step");
    const events = await listCardEvents(created.id);
    const edit = events.findLast((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit?.kind === CardEventKind.FieldEdit && edit.changes).toEqual([
      { field: EditableField.NextAction, from: "Old step", to: "New step" },
    ]);
  });

  it("clears nextAction when the patch supplies a blank one, recording it in history", async () => {
    // Given a card with an existing next step
    const created = await updateTask(
      (
        await createTask({
          title: "Clear my next step",
          origin: { type: OriginType.Manual },
        })
      ).id,
      { nextAction: "Remove me" },
    );

    // When editing it with a blank nextAction
    const updated = await updateTask(created.id, { nextAction: "" });

    // Then the field is removed (not stored as an empty string) and the
    // audit row records the clear
    expect(updated.nextAction).toBeNull();
    const reloaded = await getTask(created.id);
    expect(reloaded.nextAction).toBeNull();
    const events = await listCardEvents(created.id);
    const edit = events.findLast((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit?.kind === CardEventKind.FieldEdit && edit.changes).toEqual([
      { field: EditableField.NextAction, from: "Remove me", to: null },
    ]);
  });

  it("treats a whitespace-only nextAction patch as a clear (D8)", async () => {
    // Given a card with an existing next step
    const created = await updateTask(
      (
        await createTask({
          title: "Whitespace clear",
          origin: { type: OriginType.Manual },
        })
      ).id,
      { nextAction: "Remove me too" },
    );

    // When editing it with a whitespace-only nextAction
    const updated = await updateTask(created.id, { nextAction: "   " });

    // Then it clears, same as an explicit blank string
    expect(updated.nextAction).toBeNull();
  });

  it("clears description and nextAction independently in one patch", async () => {
    // Given a card with both a description and a next step
    const created = await updateTask(
      (
        await createTask({
          title: "Clear both",
          description: "Some detail",
          origin: { type: OriginType.Manual },
        })
      ).id,
      { nextAction: "Do the thing" },
    );

    // When one patch blanks both fields (independent $unset keys, no collision)
    const updated = await updateTask(created.id, {
      description: "",
      nextAction: "",
    });

    // Then both clear and both clears are recorded in one history row
    expect(updated.description).toBeUndefined();
    expect(updated.nextAction).toBeNull();
    const reloaded = await getTask(created.id);
    expect(reloaded.description).toBeUndefined();
    expect(reloaded.nextAction).toBeNull();
    const events = await listCardEvents(created.id);
    const edit = events.findLast((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit?.kind === CardEventKind.FieldEdit && edit.changes).toEqual(
      expect.arrayContaining([
        { field: EditableField.Description, from: "Some detail", to: null },
        { field: EditableField.NextAction, from: "Do the thing", to: null },
      ]),
    );
  });

  it("changes a card's tags on an edit, recording the old->new list in history", async () => {
    // Given a card tagged "backend"
    const created = await createCard({
      title: "Retag me",
      tags: ["backend"],
    });

    // When editing it with a different tag set
    const updated = await updateTask(created.id, {
      tags: ["backend", "urgent"],
    });

    // Then the tags change and the audit row records the old -> new list
    expect(updated.tags).toEqual(["backend", "urgent"]);
    const events = await listCardEvents(created.id);
    const edit = events.findLast((e) => e.kind === CardEventKind.FieldEdit);
    expect(edit?.kind === CardEventKind.FieldEdit && edit.changes).toEqual([
      { field: EditableField.Tags, from: "backend", to: "backend, urgent" },
    ]);
  });

  it("clears tags to an empty list and records exactly one audit row (R5)", async () => {
    // Given a card tagged "backend" and "urgent"
    const created = await createCard({
      title: "Untag me",
      tags: ["backend", "urgent"],
    });

    // When editing it with an explicit empty tags array
    const updated = await updateTask(created.id, { tags: [] });

    // Then tags are cleared to empty (a real $set, not an $unset — [] is a
    // real stored value here, unlike description/nextAction's clear convention)
    expect(updated.tags).toEqual([]);

    // And exactly one field-edit row records the old list -> empty
    const events = await listCardEvents(created.id);
    const edits = events.filter((e) => e.kind === CardEventKind.FieldEdit);
    expect(edits).toHaveLength(1);
    const [edit] = edits;
    expect(edit.kind === CardEventKind.FieldEdit && edit.changes).toEqual([
      { field: EditableField.Tags, from: "backend, urgent", to: "" },
    ]);
  });

  it("writes no audit row or updatedAt bump when the same tags are given in a different order (D13)", async () => {
    // Given a card tagged "backend" then "urgent"
    const created = await createCard({
      title: "Reorder me",
      tags: ["backend", "urgent"],
    });

    // When editing it with the identical tags in a different order
    const updated = await updateTask(created.id, {
      tags: ["urgent", "backend"],
    });

    // Then it is treated as a true no-op: no bump, no audit row
    expect(updated.updatedAt).toBe(created.updatedAt);
    const events = await listCardEvents(created.id);
    expect(events.some((e) => e.kind === CardEventKind.FieldEdit)).toBe(false);
  });

  it("does not silently persist a duplicate-bearing tags array when the set is unchanged", async () => {
    // Given a card tagged "a"
    const created = await createCard({ title: "Dedup guard", tags: ["a"] });

    // When editing it with a set-equal but duplicate-bearing tags array
    const updated = await updateTask(created.id, { tags: ["a", "a"] });

    // Then it is a true no-op: no bump, no audit row
    expect(updated.updatedAt).toBe(created.updatedAt);
    const events = await listCardEvents(created.id);
    expect(events.some((e) => e.kind === CardEventKind.FieldEdit)).toBe(false);

    // And the persisted tags stay deduped — the duplicate must not silently
    // land in storage while the diff/audit path reports "nothing changed"
    const reloaded = await getTask(created.id);
    expect(reloaded.tags).toEqual(["a"]);
  });

  it("revives a staled card back to in_progress on a real UI edit", async () => {
    // Given a card parked in the Staled lane
    const cardId = await createStaledCard("Parked work");

    // When a field is actually changed (default UI caller)
    const updated = await updateTask(cardId, { title: "Renamed" });

    // Then the card is revived and a system revive was audited
    expect(updated.status).toBe(Status.InProgress);
    expect((await getTask(cardId)).status).toBe(Status.InProgress);
    expect(await countRevives(cardId)).toBe(1);
  });

  it("does NOT revive a staled card on a no-op edit (nothing changed)", async () => {
    // Given a staled card with a known title
    const cardId = await createStaledCard("Same Title");

    // When an edit sets the title to its current value (a no-op)
    const updated = await updateTask(cardId, { title: "Same Title" });

    // Then the card stays parked and no revive was recorded
    expect(updated.status).toBe(Status.Staled);
    expect((await getTask(cardId)).status).toBe(Status.Staled);
    expect(await countRevives(cardId)).toBe(0);
  });
});

describe("deleteTask", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await cardsCollection(db).deleteMany({});
    await cardEventsCollection(db).deleteMany({});
  });

  it("archives a card and records the transition in the audit log", async () => {
    // Given a todo card
    const created = await createTask({
      title: "Archive me",
      origin: { type: OriginType.Manual },
    });

    // When it is archived
    const archived = await deleteTask(created.id);

    // Then it is in the archived state and a success transition is recorded
    expect(archived.status).toBe(Status.Archived);
    const events = await listCardEvents(created.id);
    const archiveEvent = events.find(
      (e) =>
        e.kind === CardEventKind.StatusTransition && e.to === Status.Archived,
    );
    expect(archiveEvent?.outcome).toBe(EventOutcome.Success);
  });
});
