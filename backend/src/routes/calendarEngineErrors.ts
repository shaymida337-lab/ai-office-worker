import type { Response } from "express";
import { CalendarEngineDisabledError } from "../services/calendar/calendarEngineFlags.js";
import { LifecycleError } from "../services/calendar/lifecycleErrors.js";
import { CalendarEngineServiceError } from "../services/calendar/serviceErrors.js";
import { CalendarEngineValidationError } from "./calendarEngineValidation.js";

export type CalendarEngineErrorEnvelope = {
  error: string;
  code: string;
  details?: Record<string, unknown>;
};

const HEBREW_BY_CODE: Record<string, string> = {
  CALENDAR_ENGINE_DISABLED: "מנוע היומן אינו פעיל כרגע",
  NOT_FOUND: "הפריט המבוקש לא נמצא",
  FORBIDDEN: "פעולה זו אינה מותרת",
  VALIDATION_FAILED: "נתונים לא תקינים",
  INVALID_TRANSITION: "מעבר סטטוס לא חוקי",
  STALE_DECISION: "ההחלטה אינה רלוונטית יותר",
  TIME_CONFLICT: "קיים חפיפה בזמן — יש לבחור זמן אחר",
  INTERNAL_ERROR: "אירעה שגיאה פנימית",
};

function envelope(code: string, message?: string, details?: Record<string, unknown>): CalendarEngineErrorEnvelope {
  return {
    error: message ?? HEBREW_BY_CODE[code] ?? code,
    code,
    ...(details ? { details } : {}),
  };
}

export function mapCalendarEngineError(err: unknown): { status: number; body: CalendarEngineErrorEnvelope } {
  if (err instanceof CalendarEngineDisabledError) {
    return { status: 503, body: envelope("CALENDAR_ENGINE_DISABLED", err.message) };
  }
  if (err instanceof CalendarEngineValidationError) {
    const status = err.code === "FORBIDDEN" ? 403 : 400;
    return {
      status,
      body: envelope(err.code, HEBREW_BY_CODE[err.code] ?? err.message, err.details),
    };
  }
  if (err instanceof CalendarEngineServiceError) {
    const status =
      err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : err.code === "TIME_CONFLICT" ? 409 : 422;
    return {
      status,
      body: envelope(err.code, HEBREW_BY_CODE[err.code] ?? err.message, err.details),
    };
  }
  if (err instanceof LifecycleError) {
    const status = err.code === "INVALID_TRANSITION" || err.code === "STALE_DECISION" ? 409 : 422;
    return {
      status,
      body: envelope(err.code, HEBREW_BY_CODE[err.code] ?? err.message, err.details),
    };
  }
  if (err instanceof Error) {
    return {
      status: 500,
      body: envelope("INTERNAL_ERROR", err.message || HEBREW_BY_CODE.INTERNAL_ERROR),
    };
  }
  return { status: 500, body: envelope("INTERNAL_ERROR") };
}

export function sendCalendarEngineError(res: Response, err: unknown) {
  const mapped = mapCalendarEngineError(err);
  res.status(mapped.status).json(mapped.body);
}

export function sendCalendarEngineSuccess<T>(res: Response, status: number, payload: T) {
  res.status(status).json(payload);
}
