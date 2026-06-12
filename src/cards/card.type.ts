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
  workspacePath: string | null;
  repos: RepoEntry[];
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
  workspacePath: string | null;
  repos: RepoEntry[];
}
