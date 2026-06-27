export type LifecycleErrorCode =
  | "INVALID_TRANSITION"
  | "VALIDATION_FAILED"
  | "STALE_DECISION";

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: LifecycleErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.details = details;
  }
}
