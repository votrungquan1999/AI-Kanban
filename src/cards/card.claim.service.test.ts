import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { claimCard } from "@/cards/card.claim.service";
import { createTask } from "@/cards/card.service";
import { OriginType, RunState, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind, EventOutcome } from "@/cards/card-event.type";
import { cardEventsCollection, cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

describe("claimCard", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await cardsCollection(db).deleteMany({});
    await cardEventsCollection(db).deleteMany({});
  });

  it("atomically claims a todo card and records the claim without an owner", async () => {
    // Given a card waiting in Todo
    const created = await createTask({
      title: "claim me",
      origin: { type: OriginType.Manual },
    });

    // When the card is claimed by id
    const claimed = await claimCard(created.id);

    // Then the returned client card is in progress and stamped with a pick-up time
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe(Status.InProgress);
    expect(claimed?.pickedAt).not.toBeNull();

    // And the stored doc is running, attempts incremented by one, no owner recorded
    const db = await getDb();
    const doc = await cardsCollection(db).findOne({
      _id: new ObjectId(created.id),
    });
    expect(doc?.runState).toBe(RunState.Running);
    expect(doc?.attempts).toBe(1);
    expect(doc).not.toHaveProperty("claimedBy");

    // And a successful claim audit row is appended (create + claim = 2 events)
    const events = await listCardEvents(created.id);
    expect(events).toHaveLength(2);
    const claimEvent = events.find(
      (e) =>
        e.kind === CardEventKind.StatusTransition && e.to === Status.InProgress,
    );
    expect(claimEvent?.outcome).toBe(EventOutcome.Success);
  });

  it("loses a second claim of an already-claimed card and leaves it unchanged", async () => {
    // Given a card that has already been claimed (no longer in Todo)
    const created = await createTask({
      title: "claim once",
      origin: { type: OriginType.Manual },
    });
    const first = await claimCard(created.id);
    expect(first).not.toBeNull();

    const db = await getDb();
    const before = await cardsCollection(db).findOne({
      _id: new ObjectId(created.id),
    });

    // When it is claimed again
    const second = await claimCard(created.id);

    // Then the second claim gets nothing and the stored card is unchanged
    expect(second).toBeNull();
    const after = await cardsCollection(db).findOne({
      _id: new ObjectId(created.id),
    });
    expect(after?.status).toBe(Status.InProgress);
    expect(after?.attempts).toBe(before?.attempts);
  });

  it("yields nothing when claiming a card that does not exist", async () => {
    // Given an id matching no card
    const missingId = new ObjectId();

    // When that id is claimed
    const result = await claimCard(missingId.toHexString());

    // Then the caller gets nothing and no card was created
    expect(result).toBeNull();
    const db = await getDb();
    const count = await cardsCollection(db).countDocuments({ _id: missingId });
    expect(count).toBe(0);
  });

  it("lets exactly one claim win when many race for one card", async () => {
    // Given a single card waiting in Todo
    const created = await createTask({
      title: "contended card",
      origin: { type: OriginType.Manual },
    });

    // When 25 claims for that one card run at the same time
    const results = await Promise.all(
      Array.from({ length: 25 }, () => claimCard(created.id)),
    );

    // Then exactly one claim receives the card; every other gets nothing
    const winners = results.filter((card) => card !== null);
    expect(winners).toHaveLength(1);

    // And the card is claimed exactly once (attempts incremented by one, not 25)
    const db = await getDb();
    const doc = await cardsCollection(db).findOne({
      _id: new ObjectId(created.id),
    });
    expect(doc?.status).toBe(Status.InProgress);
    expect(doc?.attempts).toBe(1);
  });
});
