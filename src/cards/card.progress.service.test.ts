import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { appendProgress } from "@/cards/card.progress.service";
import { createCard, getTask } from "@/cards/card.service";
import { reconcileStaledCards } from "@/cards/card.staled.service";
import { Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import {
  CardEventKind,
  EditableField,
  EventOutcome,
  type FieldEditEventDocument,
} from "@/cards/card-event.type";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
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

describe("appendProgress", () => {
  useTestMongo();

  it("appends a note to the card's progress history, preserving earlier notes", async () => {
    // Given an in-progress card with one note already recorded
    const card = await createCard({
      title: "Track session work",
      tags: [],
      sessionId: "session-1",
    });
    await appendProgress(card.id, "started investigation");

    // When a second note is appended
    const updated = await appendProgress(card.id, "found the bug");

    // Then both notes are present in insertion order, the first preserved verbatim
    expect(updated.progress).toHaveLength(2);
    expect(updated.progress[0].note).toBe("started investigation");
    expect(updated.progress[1].note).toBe("found the bug");
    // And each entry carries an ISO-string timestamp
    expect(typeof updated.progress[0].at).toBe("string");
  });

  it("records a FieldEdit event in the card's activity log when a note is appended", async () => {
    // Given a freshly created card (its creation emits one StatusTransition event)
    const card = await createCard({
      title: "Audit me",
      tags: [],
      sessionId: "session-1",
    });

    // When a progress note is appended
    await appendProgress(card.id, "did the thing");

    // Then exactly one FieldEdit event is recorded for the progress append,
    // by the agent, carrying the appended note as the new value
    const events = await listCardEvents(card.id);
    const fieldEdits = events.filter(
      (event): event is FieldEditEventDocument =>
        event.kind === CardEventKind.FieldEdit,
    );
    expect(fieldEdits).toHaveLength(1);
    const [edit] = fieldEdits;
    expect(edit.caller).toBe(Caller.Agent);
    expect(edit.outcome).toBe(EventOutcome.Success);
    expect(edit.changes).toEqual([
      { field: EditableField.Progress, from: null, to: "did the thing" },
    ]);
  });

  it("rejects a blank note with a validation error", async () => {
    // Given an existing card
    const card = await createCard({
      title: "No blanks",
      tags: [],
      sessionId: "session-1",
    });

    // When an empty note is appended, Then it is rejected as a domain validation
    // error (not a raw ZodError), consistent with setWorkspace
    await expect(appendProgress(card.id, "")).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });
  });

  it("revives a staled card back to in_progress when a note is appended", async () => {
    // Given a card parked in the Staled lane
    const cardId = await createStaledCard("Parked work");

    // When a progress note is appended to it
    const updated = await appendProgress(cardId, "resumed the session");

    // Then the returned card and the stored card are back in progress
    expect(updated.status).toBe(Status.InProgress);
    const after = await getTask(cardId);
    expect(after.status).toBe(Status.InProgress);
    // And a system revive was audited
    const events = await listCardEvents(cardId);
    const revives = events.filter(
      (event) =>
        event.kind === CardEventKind.StatusTransition &&
        event.caller === Caller.System &&
        event.from === Status.Staled &&
        event.to === Status.InProgress,
    );
    expect(revives).toHaveLength(1);
  });
});
