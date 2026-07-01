import type { ObjectId } from "mongodb";
import type { Status } from "@/cards/card.type";
import type { Caller } from "@/cards/transition-policy";

/** Whether a recorded card event represents a successful or rejected action. */
export enum EventOutcome {
  Success = "success",
  Failure = "failure",
}

/**
 * Discriminates the kind of audit record. A status transition (create / move)
 * versus a field edit (title / description / priority change). Legacy rows
 * written before this discriminator existed are read as `StatusTransition`.
 */
export enum CardEventKind {
  StatusTransition = "status_transition",
  FieldEdit = "field_edit",
}

/** A card field whose edits are audited in the `card_events` log. */
export enum EditableField {
  Title = "title",
  Description = "description",
  Priority = "priority",
  /** A progress note appended to the card's running history (an add, not a replace). */
  Progress = "progress",
}

/** Error detail captured on a failure event (for developer investigation). */
export interface CardEventError {
  code: string;
  message: string;
}

/** Fields shared by every audit record regardless of kind. */
export interface CardEventBase {
  _id: ObjectId;
  cardId: ObjectId;
  caller: Caller;
  at: Date;
  outcome: EventOutcome;
  error: CardEventError | null;
}

/**
 * An append-only record of a card status change: a creation, a successful
 * transition, or a rejected (failed) transition. `from` is null for a create.
 * `error` is non-null only when `outcome` is `failure`.
 */
export interface StatusTransitionEventDocument extends CardEventBase {
  kind: CardEventKind.StatusTransition;
  from: Status | null;
  to: Status;
}

/** One audited field change: which field, and its stringified old/new values. */
export interface FieldChange {
  field: EditableField;
  from: string | null;
  to: string | null;
}

/**
 * An append-only record of an operator editing a card's core fields. Carries the
 * per-field diff in `changes`; always a success (edits are audited after the DB
 * write succeeds), so `error` is null.
 */
export interface FieldEditEventDocument extends CardEventBase {
  kind: CardEventKind.FieldEdit;
  changes: FieldChange[];
}

/** Any audit record in the `card_events` collection, discriminated by `kind`. */
export type CardEventDocument =
  | StatusTransitionEventDocument
  | FieldEditEventDocument;
