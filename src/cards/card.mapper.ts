import type { z } from "zod";
import type { leanCardDocumentSchema } from "@/cards/card.document.schema";
import {
  type Card,
  type CardDocument,
  type ClientOrigin,
  type LeanCard,
  type OriginDocument,
  OriginType,
} from "@/cards/card.type";

/** The parsed shape of a lean, projected `cards` read. */
type LeanCardDocument = z.infer<typeof leanCardDocumentSchema>;

/** Lean-summary description cutoff, in Unicode code points (D10). */
const DESCRIPTION_TRUNCATE_LIMIT = 200;

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
    nextAction: doc.nextAction ?? null,
    progress: (doc.progress ?? []).map((entry) => ({
      at: entry.at.toISOString(),
      note: entry.note,
    })),
  };
}

/**
 * Shortens a description to 200 code points for the lean board summary,
 * appending an ellipsis when cut. Counted via `Array.from` so a surrogate
 * pair is never split; exactly 200 code points is not truncated.
 */
function truncateDescription(description: string): string {
  const codePoints = Array.from(description);
  if (codePoints.length <= DESCRIPTION_TRUNCATE_LIMIT) {
    return description;
  }
  return `${codePoints.slice(0, DESCRIPTION_TRUNCATE_LIMIT).join("")}…`;
}

/**
 * Converts a stored lean, projected `cards` read into the client-facing
 * {@link LeanCard} for a compact board survey. Mirrors {@link toClientCard}'s
 * optional/nullable conventions for the shared fields.
 */
export function toLeanCard(doc: LeanCardDocument): LeanCard {
  return {
    id: doc._id.toHexString(),
    number: doc.number,
    title: doc.title,
    status: doc.status,
    nextAction: doc.nextAction ?? null,
    description: doc.description
      ? truncateDescription(doc.description)
      : undefined,
  };
}
