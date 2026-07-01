import {
  type Card,
  type CardDocument,
  type ClientOrigin,
  type OriginDocument,
  OriginType,
} from "@/cards/card.type";

/** Converts a stored origin (ObjectId refs) into the client-facing origin. */
function toClientOrigin(origin: OriginDocument): ClientOrigin {
  if (origin.type === OriginType.Recurring) {
    return { type: OriginType.Recurring, defId: origin.defId.toHexString() };
  }

  return { type: OriginType.Manual };
}

/**
 * Converts a stored {@link CardDocument} into the clean client-facing
 * {@link Card}: hex string id, ISO-string timestamps, no raw document fields.
 */
export function toClientCard(doc: CardDocument): Card {
  return {
    id: doc._id.toHexString(),
    number: doc.number,
    title: doc.title,
    description: doc.description,
    status: doc.status,
    priority: doc.priority,
    origin: toClientOrigin(doc.origin),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    pickedAt: doc.pickedAt ? doc.pickedAt.toISOString() : null,
    finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
    blockedUntil: doc.blockedUntil ? doc.blockedUntil.toISOString() : null,
    blockInterval: doc.blockInterval ?? null,
    workspacePath: doc.workspacePath,
    repos: doc.repos,
    tags: doc.tags ?? [],
    sessionId: doc.sessionId ?? null,
    progress: (doc.progress ?? []).map((entry) => ({
      at: entry.at.toISOString(),
      note: entry.note,
    })),
  };
}
