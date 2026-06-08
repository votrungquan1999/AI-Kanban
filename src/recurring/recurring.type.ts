import type { ObjectId } from "mongodb";

/**
 * Lifecycle state of a recurring task's most recent run. Deliberately a 3-value
 * enum (NOT the 6-value board `RunState`): a task is `idle` (waiting for its
 * next due wake), `running` (a routine has claimed it and is executing now), or
 * `failed` (a run failed and the task is parked until an operator resets it).
 */
export enum RecurringRunState {
  Idle = "idle",
  Running = "running",
  Failed = "failed",
}

/** Whether the last completed run of a recurring task succeeded or failed. */
export enum RecurringOutcome {
  Success = "success",
  Failure = "failure",
}

/**
 * A recurring task as stored in MongoDB. Repo-less by design: it carries an
 * `instruction` (the prompt a Claude routine follows) and a simple interval
 * schedule (`everyHours`); no board/workspace fields. Runtime fields are set to
 * defaults on create; `failureReason`/`fixNote` are added by later behaviors.
 */
export interface RecurringTaskDocument {
  _id: ObjectId;
  number: number;
  title: string;
  instruction: string;
  everyHours: number;
  enabled: boolean;
  runState: RecurringRunState;
  nextDueAt: Date;
  lastRunAt: Date | null;
  lastOutcome: RecurringOutcome | null;
  failureReason?: string;
  fixNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A recurring task as exposed to the client — never expose raw documents. */
export interface RecurringTask {
  id: string;
  number: number;
  title: string;
  instruction: string;
  everyHours: number;
  enabled: boolean;
  runState: RecurringRunState;
  nextDueAt: string;
  lastRunAt: string | null;
  lastOutcome: RecurringOutcome | null;
  failureReason?: string;
  fixNote?: string;
  createdAt: string;
  updatedAt: string;
}
