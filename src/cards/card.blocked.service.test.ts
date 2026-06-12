import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { reconcileBlockedCards } from "@/cards/card.blocked.service";
import { createTask, getTask, updateTaskStatus } from "@/cards/card.service";
import { OriginType, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind } from "@/cards/card-event.type";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Force a blocked card's deadline into the past so it is overdue. */
async function expireBlockedCard(cardId: string): Promise<void> {
  const db = await getDb();
  await cardsCollection(db).updateOne(
    { _id: new ObjectId(cardId) },
    { $set: { blockedUntil: new Date(Date.now() - 1000) } },
  );
}

describe("blocked-card clock", () => {
  useTestMongo();

  it("starts a ~2-hour countdown when a card is blocked", async () => {
    // Given a fresh card with no deadline
    const card = await createTask({
      title: "Waiting on review feedback",
      origin: { type: OriginType.Manual },
    });
    expect(card.blockedUntil).toBeNull();

    // When the user blocks it
    const blocked = await updateTaskStatus(card.id, Status.Blocked);

    // Then it carries a deadline roughly two hours out
    expect(blocked.blockedUntil).not.toBeNull();
    const deadlineMs = new Date(blocked.blockedUntil as string).getTime();
    const expectedMs = Date.now() + TWO_HOURS_MS;
    // generous tolerance: server clock vs test clock, ±1 minute
    expect(Math.abs(deadlineMs - expectedMs)).toBeLessThan(60_000);
  });

  it("restarts the 2-hour countdown when the user keeps a card blocked", async () => {
    // Given a blocked card whose deadline is nearly up (1 minute away)
    const card = await createTask({
      title: "Still waiting",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(card.id, Status.Blocked);
    const db = await getDb();
    const nearlyExpired = new Date(Date.now() + 60_000);
    await cardsCollection(db).updateOne(
      { _id: new ObjectId(card.id) },
      { $set: { blockedUntil: nearlyExpired } },
    );

    // When the user keeps it blocked ("Still Blocked" re-enters Blocked)
    const kept = await updateTaskStatus(card.id, Status.Blocked);

    // Then it stays Blocked and the deadline is pushed back to ~2h out, far
    // beyond the stale 1 minute (proving the reset branch won over "preserve")
    expect(kept.status).toBe(Status.Blocked);
    const deadlineMs = new Date(kept.blockedUntil as string).getTime();
    const expectedMs = Date.now() + TWO_HOURS_MS;
    expect(Math.abs(deadlineMs - expectedMs)).toBeLessThan(60_000);
  });

  it("clears the countdown when a card leaves Blocked", async () => {
    // Given a blocked card with a running deadline
    const card = await createTask({
      title: "Unblock me",
      origin: { type: OriginType.Manual },
    });
    const blocked = await updateTaskStatus(card.id, Status.Blocked);
    expect(blocked.blockedUntil).not.toBeNull();

    // When it moves out of Blocked to any other column
    const moved = await updateTaskStatus(card.id, Status.NeedReview);

    // Then the deadline is gone
    expect(moved.status).toBe(Status.NeedReview);
    expect(moved.blockedUntil).toBeNull();
  });
});

describe("reconcileBlockedCards", () => {
  useTestMongo();

  it("auto-moves an overdue blocked card to Need Review and clears its deadline", async () => {
    // Given a blocked card whose 2h deadline has already elapsed
    const card = await createTask({
      title: "Overdue block",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(card.id, Status.Blocked);
    await expireBlockedCard(card.id);

    // When the board is read (reconcile runs)
    await reconcileBlockedCards();

    // Then the card is now in Need Review with no deadline
    const after = await getTask(card.id);
    expect(after.status).toBe(Status.NeedReview);
    expect(after.blockedUntil).toBeNull();
  });

  it("leaves a blocked card whose deadline has not yet passed", async () => {
    // Given a blocked card with ~2h still on the clock
    const card = await createTask({
      title: "Recently blocked",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(card.id, Status.Blocked);

    // When the board is read
    await reconcileBlockedCards();

    // Then it stays Blocked with its deadline intact
    const after = await getTask(card.id);
    expect(after.status).toBe(Status.Blocked);
    expect(after.blockedUntil).not.toBeNull();
  });

  it("moves and audits an overdue card only once across repeated reads", async () => {
    // Given an overdue blocked card
    const card = await createTask({
      title: "Reconciled twice",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(card.id, Status.Blocked);
    await expireBlockedCard(card.id);

    // When the board is read twice in a row (e.g. load racing a refresh)
    await reconcileBlockedCards();
    await reconcileBlockedCards();

    // Then exactly one system-audited Blocked→NeedReview event was recorded
    const events = await listCardEvents(card.id);
    const systemMoves = events.filter(
      (event) =>
        event.kind === CardEventKind.StatusTransition &&
        event.caller === Caller.System &&
        event.from === Status.Blocked &&
        event.to === Status.NeedReview,
    );
    expect(systemMoves).toHaveLength(1);
  });
});
