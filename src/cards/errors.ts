/** Stable, serializable error codes returned by the card service. */
export enum ErrorCode {
  Validation = "ERR_VALIDATION",
  Duplicate = "ERR_DUPLICATE",
  NotFound = "ERR_NOT_FOUND",
  InvalidTransition = "ERR_INVALID_TRANSITION",
  SchemaDrift = "ERR_SCHEMA_DRIFT",
  /** A recurring task could not be claimed because it is already running. */
  AlreadyRunning = "ERR_ALREADY_RUNNING",
  /** A recurring task could not be claimed because it is disabled or not yet due. */
  NotDue = "ERR_NOT_DUE",
}

/** A domain error carrying a stable {@link ErrorCode}. */
export class AppError extends Error {
  readonly code: ErrorCode;

  /**
   * @param code - The stable error code clients can branch on.
   * @param message - Human-readable detail.
   */
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}
