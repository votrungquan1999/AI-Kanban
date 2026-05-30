import type { ObjectId } from "mongodb";
import type { Status } from "@/cards/card.type";
import type { Caller } from "@/cards/transition-policy";

/** Whether a recorded card event represents a successful or rejected action. */
export enum EventOutcome {
  Success = "success",
  Failure = "failure",
}

/** Error detail captured on a failure event (for developer investigation). */
export interface CardEventError {
  code: string;
  message: string;
}

/**
 * An append-only audit record of a card lifecycle action: a creation, a
 * successful transition, or a rejected (failed) transition. `from` is null for
 * a create. `error` is non-null only when `outcome` is `failure`.
 */
export interface CardEventDocument {
  _id: ObjectId;
  cardId: ObjectId;
  from: Status | null;
  to: Status;
  caller: Caller;
  at: Date;
  outcome: EventOutcome;
  error: CardEventError | null;
}
