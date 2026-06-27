export class CalendarEngineServiceError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CalendarEngineServiceError";
    this.code = code;
    this.details = details;
  }
}

export function notFound(entity: string): CalendarEngineServiceError {
  return new CalendarEngineServiceError("NOT_FOUND", `${entity} not found`);
}

export function forbidden(message = "Forbidden"): CalendarEngineServiceError {
  return new CalendarEngineServiceError("FORBIDDEN", message);
}
