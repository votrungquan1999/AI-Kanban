import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  appendDecision,
  markDecisionOutdated,
} from "@/cards/card.decision.service";
import { createCard, getTask } from "@/cards/card.service";
import { reconcileStaledCards } from "@/cards/card.staled.service";
import { DecisionStatus, Status } from "@/cards/card.type";
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

/** Assert exactly `count` system Staled -> InProgress revive events on a card. */
async function expectRevives(cardId: string, count: number): Promise<void> {
  const events = await listCardEvents(cardId);
  const revives = events.filter(
    (event) =>
      event.kind === CardEventKind.StatusTransition &&
      event.caller === Caller.System &&
      event.from === Status.Staled &&
      event.to === Status.InProgress,
  );
  expect(revives).toHaveLength(count);
}

describe("appendDecision", () => {
  useTestMongo();

  it("appends a decision to the card's decision history, preserving earlier decisions", async () => {
    // Given an in-progress card with one decision already recorded
    const card = await createCard({
      title: "Track session work",
      tags: [],
      sessionId: "session-1",
    });
    await appendDecision(card.id, "use numeric-index positional updates");

    // When a second decision is recorded
    const updated = await appendDecision(
      card.id,
      "reuse the appendProgress pattern",
    );

    // Then both decisions are present in insertion order, the first preserved verbatim
    expect(updated.decisions).toHaveLength(2);
    expect(updated.decisions[0].decision).toBe(
      "use numeric-index positional updates",
    );
    expect(updated.decisions[1].decision).toBe(
      "reuse the appendProgress pattern",
    );
    // And each entry starts life as an active decision with an ISO timestamp
    expect(updated.decisions[0].status).toBe(DecisionStatus.Active);
    expect(typeof updated.decisions[0].at).toBe("string");
  });

  it("records a FieldEdit event in the card's activity log when a decision is appended", async () => {
    // Given a freshly created card (its creation emits one StatusTransition event)
    const card = await createCard({
      title: "Audit me",
      tags: [],
      sessionId: "session-1",
    });

    // When a decision is appended
    await appendDecision(card.id, "use the append-only decisions[] pattern");

    // Then exactly one FieldEdit event is recorded for the decision append,
    // by the agent, carrying the appended decision as the new value
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
      {
        field: EditableField.Decision,
        from: null,
        to: "use the append-only decisions[] pattern",
      },
    ]);
  });

  it("bumps the card's updatedAt when a decision is recorded, keeping it fresh", async () => {
    // Given an existing card
    const card = await createCard({
      title: "Stay fresh",
      tags: [],
      sessionId: "session-1",
    });
    const originalUpdatedAt = card.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));

    // When a decision is recorded
    const updated = await appendDecision(card.id, "keep the card warm");

    // Then updatedAt moved forward, even though no status changed
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it("rejects a whitespace-only decision with a validation error", async () => {
    // Given an existing card
    const card = await createCard({
      title: "No blanks",
      tags: [],
      sessionId: "session-1",
    });

    // When a whitespace-only decision is recorded, Then it is rejected as a
    // domain validation error (not a raw ZodError), consistent with appendProgress
    await expect(appendDecision(card.id, "   ")).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });
  });

  it("normalizes a whitespace-only why to absent rather than storing it", async () => {
    // Given an existing card
    const card = await createCard({
      title: "Blank why",
      tags: [],
      sessionId: "session-1",
    });

    // When a decision is recorded with a whitespace-only reason
    const updated = await appendDecision(
      card.id,
      "skip the reason this time",
      "   ",
    );

    // Then the reason surfaces as absent, not as a stored blank string
    expect(updated.decisions[0].why).toBeUndefined();

    // And the card still reads back cleanly (no SchemaDrift from a stored
    // BSON null on the next read)
    const reread = await getTask(card.id);
    expect(reread.decisions[0].why).toBeUndefined();
  });

  it("returns a NotFound error for a card that doesn't exist", async () => {
    // When a decision is recorded against an id with no matching card
    await expect(
      appendDecision(new ObjectId().toHexString(), "does not matter"),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });

  it("revives a staled card back to in_progress when a decision is appended", async () => {
    // Given a card parked in the Staled lane
    const cardId = await createStaledCard("Parked work");

    // When a decision is appended to it
    const updated = await appendDecision(cardId, "picked approach A");

    // Then the card is back in progress and a system revive was audited
    expect(updated.status).toBe(Status.InProgress);
    expect((await getTask(cardId)).status).toBe(Status.InProgress);
    await expectRevives(cardId, 1);
  });
});

describe("markDecisionOutdated", () => {
  useTestMongo();

  it("marks a decision outdated, records what replaced it, and preserves the original text exactly", async () => {
    // Given a card with two recorded decisions
    const card = await createCard({
      title: "Supersede me",
      tags: [],
      sessionId: "session-1",
    });
    await appendDecision(card.id, "use positional $set", "simplest option");
    await appendDecision(card.id, "use arrayFilters instead");

    // When the first decision is marked outdated, superseded by the second
    const updated = await markDecisionOutdated(card.id, 0, 1);

    // Then the first entry flips to outdated and records its replacement,
    // while its original wording is preserved exactly
    expect(updated.decisions[0].status).toBe(DecisionStatus.Outdated);
    expect(updated.decisions[0].supersededByIndex).toBe(1);
    expect(updated.decisions[0].decision).toBe("use positional $set");
    expect(updated.decisions[0].why).toBe("simplest option");

    // And the second (replacing) entry is untouched
    expect(updated.decisions[1].status).toBe(DecisionStatus.Active);
    expect(updated.decisions[1].decision).toBe("use arrayFilters instead");
  });

  it("marking without a replacement leaves supersededByIndex absent, not stored as null", async () => {
    // Given a card with one recorded decision
    const card = await createCard({
      title: "No replacement yet",
      tags: [],
      sessionId: "session-1",
    });
    await appendDecision(card.id, "pause on this for now");

    // When it is marked outdated with no supersededByIndex
    const updated = await markDecisionOutdated(card.id, 0);

    // Then supersededByIndex surfaces as absent, not a stored null
    expect(updated.decisions[0].supersededByIndex).toBeUndefined();

    // And the card still reads back cleanly (no SchemaDrift from a stored
    // BSON null on the next read)
    const reread = await getTask(card.id);
    expect(reread.decisions[0].supersededByIndex).toBeUndefined();
  });

  it("rejects marking a decision as superseded by itself", async () => {
    // Given a card with one recorded decision
    const card = await createCard({
      title: "No self-reference",
      tags: [],
      sessionId: "session-1",
    });
    await appendDecision(card.id, "a decision");

    // When it is marked outdated with itself as the replacement, Then it is
    // rejected as a domain validation error (incoherent — a decision cannot
    // supersede itself)
    await expect(markDecisionOutdated(card.id, 0, 0)).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });
  });

  it("returns a NotFound error for a card that doesn't exist", async () => {
    // When a decision is marked outdated against an id with no matching card
    await expect(
      markDecisionOutdated(new ObjectId().toHexString(), 0),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });

  it("returns a NotFound error for an index that doesn't exist on the card", async () => {
    // Given a card with exactly one recorded decision (valid index: 0 only)
    const card = await createCard({
      title: "Out of range",
      tags: [],
      sessionId: "session-1",
    });
    await appendDecision(card.id, "the only decision");

    // When an out-of-range index is marked outdated
    await expect(markDecisionOutdated(card.id, 5)).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
  });

  it("allows re-marking an already-outdated decision as a no-op-style update, not an error", async () => {
    // Given a decision already marked outdated, superseded by index 1
    const card = await createCard({
      title: "Re-mark me",
      tags: [],
      sessionId: "session-1",
    });
    await appendDecision(card.id, "first take");
    await appendDecision(card.id, "second take");
    await appendDecision(card.id, "third take");
    await markDecisionOutdated(card.id, 0, 1);

    // When it is marked outdated again with a different replacement
    const updated = await markDecisionOutdated(card.id, 0, 2);

    // Then it succeeds (no error) and the newer supersededByIndex wins
    expect(updated.decisions[0].status).toBe(DecisionStatus.Outdated);
    expect(updated.decisions[0].supersededByIndex).toBe(2);
  });

  it("revives a staled card back to in_progress when a decision is marked outdated", async () => {
    // Given a card with a decision that is then parked in the Staled lane
    const card = await createCard({
      title: "Parked work",
      tags: [],
      sessionId: "session-1",
    });
    await appendDecision(card.id, "initial approach");
    const db = await getDb();
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(card.id) },
      { $set: { updatedAt: new Date(Date.now() - THREE_HOURS_MS - 1000) } },
    );
    await reconcileStaledCards();

    // When a decision is marked outdated
    const updated = await markDecisionOutdated(card.id, 0);

    // Then the card is revived and a system revive was audited
    expect(updated.status).toBe(Status.InProgress);
    expect((await getTask(card.id)).status).toBe(Status.InProgress);
    await expectRevives(card.id, 1);
  });
});
