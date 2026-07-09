import type { ObjectId } from "mongodb";

/** Board column / lifecycle status of a card. */
export enum Status {
  Todo = "todo",
  InProgress = "in_progress",
  NeedReview = "need_review",
  Done = "done",
  /**
   * Parked waiting on something. Carries a `blockedUntil` deadline; once it
   * passes, the card auto-advances to NeedReview on the next board read.
   */
  Blocked = "blocked",
  /** Long-idle in-progress work auto-parked on the next board read. */
  Staled = "staled",
  /** Soft-deleted: hidden from the board's default view, not a board column. */
  Archived = "archived",
}

/** What a card originated from. */
export enum OriginType {
  Manual = "manual",
  Recurring = "recurring",
}

/** Runtime lifecycle of a card's session (managed by the scheduler/runner). */
export enum RunState {
  Idle = "idle",
  Starting = "starting",
  Running = "running",
  Waiting = "waiting",
  Exited = "exited",
  Failed = "failed",
}

/** Origin as stored in the DB (recurring carries an ObjectId reference). */
export type OriginDocument =
  | { type: OriginType.Manual }
  | { type: OriginType.Recurring; defId: ObjectId };

/** Origin as exposed to the client (ids are hex strings). */
export type ClientOrigin =
  | { type: OriginType.Manual }
  | { type: OriginType.Recurring; defId: string };

export interface ProcessInfo {
  pid: number;
  startedAt: Date;
}

export interface CardErrorInfo {
  code: string;
  message: string;
  at: Date;
}

/**
 * One repository the agent checked out for a card: the repo it cloned, the
 * branch it created, and the worktree path on disk. Pure strings, so the stored
 * and client-facing shapes are identical (no ObjectId/Date conversion).
 */
export interface RepoEntry {
  repo: string;
  branch: string;
  worktreePath: string;
}

/** One timestamped progress note embedded in a card document (BSON Date). */
export interface ProgressEntry {
  at: Date;
  note: string;
}

/** One progress note as exposed to the client — `at` is an ISO string. */
export interface ClientProgressEntry {
  at: string;
  note: string;
}

/**
 * A card as stored in MongoDB. Runtime fields are set to defaults/null on
 * create; no logic is built around them in this slice.
 */
export interface CardDocument {
  _id: ObjectId;
  number: number;
  title: string;
  description?: string;
  status: Status;
  priority: number;
  origin: OriginDocument;
  dedupeKey: string | null;
  runState: RunState;
  process: ProcessInfo | null;
  attempts: number;
  restarts: number;
  nextStartAfter: Date | null;
  lastError: CardErrorInfo | null;
  createdAt: Date;
  updatedAt: Date;
  pickedAt: Date | null;
  finishedAt: Date | null;
  /**
   * When a Blocked card should auto-advance to NeedReview. Optional (not just
   * nullable): legacy docs predate the field and omit it entirely — mirrors the
   * schema's `.nullable().optional()` so parse-on-read accepts them.
   */
  blockedUntil?: Date | null;
  /**
   * The block countdown duration (ms) the card was last blocked with, replayed
   * by "Reset timer". Optional + nullable like {@link CardDocument.blockedUntil}:
   * legacy docs omit it (absent ≠ null), so parse-on-read tolerates them.
   */
  blockInterval?: number | null;
  workspacePath: string | null;
  repos: RepoEntry[];
  /** Labels on this card. Absent on pre-feature docs; mapper coerces → []. */
  tags?: string[];
  /** Claude session ID that owns this card. Absent on legacy docs; → null. */
  sessionId?: string | null;
  /** Ordered progress notes. Absent on pre-feature docs; mapper coerces → []. */
  progress?: ProgressEntry[];
  /** Forward-looking next step. Absent on pre-feature docs; mapper coerces → null. */
  nextAction?: string | null;
}

/** A card as exposed to the client — never expose raw documents. */
export interface Card {
  id: string;
  number: number;
  title: string;
  description?: string;
  status: Status;
  priority: number;
  origin: ClientOrigin;
  createdAt: string;
  updatedAt: string;
  pickedAt: string | null;
  finishedAt: string | null;
  /** ISO timestamp when a Blocked card auto-advances to NeedReview; else null. */
  blockedUntil: string | null;
  /** Block countdown duration (ms) the card was last blocked with; else null. */
  blockInterval: number | null;
  workspacePath: string | null;
  repos: RepoEntry[];
  /** Labels on this card; empty array when none. */
  tags: string[];
  /** Claude session ID attached to this card; null when absent. */
  sessionId: string | null;
  /** Ordered progress notes; empty array when none. */
  progress: ClientProgressEntry[];
  /** Forward-looking next step for this card; null when none set. */
  nextAction: string | null;
}

/**
 * A lean, projected card for a compact board survey (see `listCards` in
 * `src/cards/card.service.ts`) — mirrors {@link Card}'s optionality for shared
 * fields (`description` absent when unset, `nextAction` null when unset).
 */
export interface LeanCard {
  id: string;
  number: number;
  title: string;
  status: Status;
  nextAction: string | null;
  description?: string;
}
