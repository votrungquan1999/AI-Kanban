import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import { OriginType, RunState, Status } from "@/cards/card.type";

/**
 * Builds a raw `cards` document as it would have been stored BEFORE the
 * blocked-column feature existed: it carries every field the model has ever
 * required, but deliberately OMITS `blockedUntil` entirely (the field did not
 * exist yet). `null` is not the same as absent — a legacy doc has no key at all.
 */
function legacyCardDocWithoutBlockedUntil() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    _id: new ObjectId(),
    number: 7,
    title: "A card from before the blocked feature",
    status: Status.Todo,
    priority: 0,
    origin: { type: OriginType.Manual },
    dedupeKey: null,
    runState: RunState.Idle,
    process: null,
    attempts: 0,
    restarts: 0,
    nextStartAfter: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    pickedAt: null,
    finishedAt: null,
    workspacePath: null,
    repos: [],
  };
}

describe("cardDocumentSchema blocked-until back-compat", () => {
  it("opens a pre-feature card (no blockedUntil) and reads it as having no deadline", () => {
    // Given a card document stored before `blockedUntil` existed
    const legacyDoc = legacyCardDocWithoutBlockedUntil();

    // When it is read back through the parse-on-read boundary and mapped
    const parsed = cardDocumentSchema.parse(legacyDoc);
    const card = toClientCard(parsed);

    // Then it loads fine and surfaces no deadline (not a crash, not undefined)
    expect(card.blockedUntil).toBeNull();
  });
});
