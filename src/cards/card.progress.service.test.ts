import { describe, expect, it } from "vitest";
import { appendProgress } from "@/cards/card.progress.service";
import { createCard } from "@/cards/card.service";
import { listCardEvents } from "@/cards/card-event.service";
import {
  CardEventKind,
  EditableField,
  EventOutcome,
  type FieldEditEventDocument,
} from "@/cards/card-event.type";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { useTestMongo } from "@/test/use-test-mongo";

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
});
