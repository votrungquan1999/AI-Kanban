import { describe, expect, it } from "vitest";
import { adoptCard } from "@/cards/card.adopt.service";
import { createCard, getTask, updateTaskStatus } from "@/cards/card.service";
import { Status } from "@/cards/card.type";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
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
});
