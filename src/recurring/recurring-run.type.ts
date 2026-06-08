import type { ObjectId } from "mongodb";
import type { RecurringOutcome } from "@/recurring/recurring.type";

/**
 * An append-only record of one execution of a recurring task: when it started
 * (the claim time), when it finished, whether it succeeded, and a short
 * human-readable `note` (success) or `error` (failure). Simpler than
 * `card_events` — single-kind, no discriminator.
 */
export interface RecurringRunDocument {
  _id: ObjectId;
  recurringId: ObjectId;
  at: Date;
  startedAt: Date;
  finishedAt: Date;
  outcome: RecurringOutcome;
  note?: string;
  error?: string;
}
