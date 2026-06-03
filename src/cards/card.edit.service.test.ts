import { beforeEach, describe, expect, it } from "vitest";
import { deleteTask, updateTask } from "@/cards/card.edit.service";
import { createTask, getTask } from "@/cards/card.service";
import { OriginType, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import {
  CardEventKind,
  EditableField,
  EventOutcome,
} from "@/cards/card-event.type";
import { cardEventsCollection, cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

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
