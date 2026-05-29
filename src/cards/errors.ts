/** Stable, serializable error codes returned by the card service. */
export enum ErrorCode {
  Validation = "ERR_VALIDATION",
  Duplicate = "ERR_DUPLICATE",
  NotFound = "ERR_NOT_FOUND",
  InvalidTransition = "ERR_INVALID_TRANSITION",
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
