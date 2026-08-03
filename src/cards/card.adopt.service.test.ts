import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { adoptCard } from "@/cards/card.adopt.service";
import {
  createCard,
  createTask,
  getTask,
  updateTaskStatus,
} from "@/cards/card.service";
import type { Card } from "@/cards/card.type";
import { OriginType, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind, EditableField } from "@/cards/card-event.type";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { clearCollectionsEachTest, useTestMongo } from "@/test/use-test-mongo";

describe("adoptCard", () => {
  useTestMongo();
  clearCollectionsEachTest();

  it("moves ownership so the adopting session's own create_card reclaims this card instead of opening another", async () => {
    // Given a card opened by a session that has since ended, parked for review
    const original = await createCard({
      title: "supplier profile scoping",
      tags: [],
      sessionId: "session-old",
    });
    await updateTaskStatus(original.id, Status.NeedReview, {
      caller: Caller.Agent,
    });

    // When a new session takes the card over
    await adoptCard(original.id, "session-new");

    // Then that session's own create_card reclaims this very card — the
    // server's idempotency now knows the adoption happened, so a compact-wiped
    // resume cannot fan out a second card for the same work
    const reclaimed = await createCard({
      title: "supplier profile scoping",
      tags: [],
      sessionId: "session-new",
    });
    expect(reclaimed.id).toBe(original.id);
  });

  it("refuses to adopt a FINISHED card into a session that already has an open card", async () => {
    // Given a session already working its own open card
    await createCard({
      title: "what this session is already doing",
      tags: [],
      sessionId: "session-busy",
    });

    // And prior work that is already done — the common case this feature
    // exists to find, and the one the partial-unique index cannot police
    const finished = await createCard({
      title: "prior work, long since finished",
      tags: [],
      sessionId: "session-old",
    });
    await updateTaskStatus(finished.id, Status.Done, { caller: Caller.Agent });

    // When the busy session tries to take that finished card over
    // Then it is refused, instead of quietly ending up with two cards under
    // one dedupe key and a finished card that can never be reopened
    await expect(adoptCard(finished.id, "session-busy")).rejects.toMatchObject({
      code: ErrorCode.Duplicate,
    });

    // And the card is untouched — no half-applied re-stamp
    const untouched = await getTask(finished.id);
    expect(untouched.sessionId).toBe("session-old");
  });

  it("reports a re-stamp that would collide with the session's own live card, rather than dropping it", async () => {
    // Given a session already working its own open card
    await createCard({
      title: "what this session is already doing",
      tags: [],
      sessionId: "session-busy",
    });

    // And another session's card, parked, that it tries to take over as well
    const other = await createCard({
      title: "somebody else's parked work",
      tags: [],
      sessionId: "session-other",
    });
    await updateTaskStatus(other.id, Status.NeedReview, {
      caller: Caller.Agent,
    });

    // When the busy session tries to adopt that card too
    // Then it is told, rather than the re-stamp vanishing silently
    await expect(adoptCard(other.id, "session-busy")).rejects.toMatchObject({
      code: ErrorCode.Duplicate,
    });

    // And the card it failed to adopt still belongs to its original session
    const untouched = await getTask(other.id);
    expect(untouched.sessionId).toBe("session-other");
  });

  it("refuses to adopt a card carrying an external dedupe key, rather than destroying it", async () => {
    // Given a card imported under someone else's idempotency key
    const imported = await createTask({
      title: "imported from notion",
      origin: { type: OriginType.Manual },
      dedupeKey: "notion:page-1",
    });

    // When a session tries to take it over
    // Then it is refused — adopting would overwrite the key its importer
    // relies on to avoid re-importing, and nothing could recover it
    await expect(adoptCard(imported.id, "session-new")).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });

    // And the external key is intact
    const db = await getDb();
    const stored = await cardsCollection(db).findOne({
      _id: new ObjectId(imported.id),
    });
    expect(stored?.dedupeKey).toBe("notion:page-1");
  });

  it("refuses to adopt a queued card, which belongs to claim_card", async () => {
    // Given a card sitting in the todo queue, owned by nobody
    const queued = await createTask({
      title: "queued work nobody has picked up",
      origin: { type: OriginType.Manual },
    });

    // When a session tries to adopt it instead of claiming it
    // Then it is refused — adopting would take the card out of the queue while
    // bypassing the atomic single-claim guarantee claim_card exists to give
    await expect(adoptCard(queued.id, "session-new")).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });
  });

  it("lets only one of two sessions racing for the same card win", async () => {
    // Given a parked card two sessions both believe is theirs
    const contested = await createCard({
      title: "work two sessions both resumed",
      tags: [],
      sessionId: "session-original",
    });
    await updateTaskStatus(contested.id, Status.NeedReview, {
      caller: Caller.Agent,
    });

    // When both adopt it at once
    const results = await Promise.allSettled([
      adoptCard(contested.id, "session-a"),
      adoptCard(contested.id, "session-b"),
    ]);

    // Then exactly one succeeds — two "successes" would leave the loser
    // holding a pointer to a card it does not own, and its next create_card
    // would open a duplicate
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    // And the stored owner is the one that won, not a blend of the two
    const stored = await getTask(contested.id);
    const winner = fulfilled[0] as PromiseFulfilledResult<Card>;
    expect(stored.sessionId).toBe(winner.value.sessionId);
  });

  it("records the ownership transfer in the card's audit trail", async () => {
    // Given a parked card belonging to an earlier session
    const card = await createCard({
      title: "work changing hands",
      tags: [],
      sessionId: "session-original",
    });
    await updateTaskStatus(card.id, Status.NeedReview, {
      caller: Caller.Agent,
    });
    const before = await listCardEvents(card.id);

    // When another session adopts it
    await adoptCard(card.id, "session-new");

    // Then the hand-over is on the record — it rewrites who is responsible for
    // the card, so a duplicate cluster can be traced back to who adopted what
    const after = await listCardEvents(card.id);
    expect(after).toHaveLength(before.length + 1);
    const [transfer] = after.slice(-1);
    if (transfer.kind !== CardEventKind.FieldEdit) {
      throw new Error("expected a field-edit event for the ownership transfer");
    }
    expect(transfer.caller).toBe(Caller.Agent);
    expect(transfer.changes).toEqual([
      {
        field: EditableField.SessionId,
        from: "session-original",
        to: "session-new",
      },
    ]);
  });
});
