import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createCard, getTask } from "@/cards/card.service";
import {
  reconcileStaledCards,
  reviveStaledCard,
} from "@/cards/card.staled.service";
import { Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind } from "@/cards/card-event.type";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { clearCollectionsEachTest, useTestMongo } from "@/test/use-test-mongo";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/** Back-date a card's `updatedAt` past the 3h idle threshold so it is stale. */
async function makeCardStale(cardId: string): Promise<void> {
  const db = await getDb();
  await cardsCollection(db).updateOne(
    { _id: new ObjectId(cardId) },
    { $set: { updatedAt: new Date(Date.now() - THREE_HOURS_MS - 1000) } },
  );
}

/** Create an in-progress card and park it in the Staled lane via reconcile. */
async function createStaledCard(title: string): Promise<string> {
  const card = await createCard({ title, tags: [], sessionId: "session-1" });
  await makeCardStale(card.id);
  await reconcileStaledCards();
  return card.id;
}

describe("reviveStaledCard", () => {
  useTestMongo();
  clearCollectionsEachTest();

  it("moves a staled card back to in_progress and audits a system revive", async () => {
    // Given a card parked in the Staled lane
    const cardId = await createStaledCard("Parked work");

    // When a content update revives it
    const revived = await reviveStaledCard(new ObjectId(cardId));

    // Then it is back in progress...
    expect(revived?.status).toBe(Status.InProgress);
    const after = await getTask(cardId);
    expect(after.status).toBe(Status.InProgress);

    // ...and the revive is audited as a system Staled -> InProgress transition
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

  it("leaves a non-staled card untouched and audits nothing", async () => {
    // Given a fresh in-progress card (never parked)
    const card = await createCard({
      title: "Active work",
      tags: [],
      sessionId: "session-1",
    });

    // When revive runs against it
    const revived = await reviveStaledCard(new ObjectId(card.id));

    // Then nothing moved and no revive event was recorded
    expect(revived).toBeNull();
    const after = await getTask(card.id);
    expect(after.status).toBe(Status.InProgress);
    const events = await listCardEvents(card.id);
    const revives = events.filter(
      (event) =>
        event.kind === CardEventKind.StatusTransition &&
        event.caller === Caller.System &&
        event.from === Status.Staled &&
        event.to === Status.InProgress,
    );
    expect(revives).toHaveLength(0);
  });
});

describe("reconcileStaledCards", () => {
  useTestMongo();
  clearCollectionsEachTest();

  it("auto-parks an in-progress card untouched for 3+ hours in Staled", async () => {
    // Given an in-progress card whose last touch is more than 3 hours ago
    const card = await createCard({
      title: "Idle work",
      tags: [],
      sessionId: "session-1",
    });
    await makeCardStale(card.id);

    // When the board is read (reconcile runs)
    await reconcileStaledCards();

    // Then the card is parked in the Staled lane
    const after = await getTask(card.id);
    expect(after.status).toBe(Status.Staled);
  });

  it("leaves an in-progress card touched within the last 3 hours in progress", async () => {
    // Given a fresh in-progress card (last touched just now)
    const card = await createCard({
      title: "Active work",
      tags: [],
      sessionId: "session-1",
    });

    // When the board is read
    await reconcileStaledCards();

    // Then it stays in progress and no stale-move was recorded
    const after = await getTask(card.id);
    expect(after.status).toBe(Status.InProgress);
    const events = await listCardEvents(card.id);
    const staleMoves = events.filter(
      (event) =>
        event.kind === CardEventKind.StatusTransition &&
        event.caller === Caller.System &&
        event.to === Status.Staled,
    );
    expect(staleMoves).toHaveLength(0);
  });

  it("parks and audits a stale card only once across repeated reads", async () => {
    // Given a stale in-progress card
    const card = await createCard({
      title: "Reconciled twice",
      tags: [],
      sessionId: "session-1",
    });
    await makeCardStale(card.id);

    // When the board is read twice in a row (e.g. load racing a refresh)
    await reconcileStaledCards();
    await reconcileStaledCards();

    // Then exactly one system-audited in_progress -> staled event was recorded
    const events = await listCardEvents(card.id);
    const staleMoves = events.filter(
      (event) =>
        event.kind === CardEventKind.StatusTransition &&
        event.caller === Caller.System &&
        event.from === Status.InProgress &&
        event.to === Status.Staled,
    );
    expect(staleMoves).toHaveLength(1);
  });
});
