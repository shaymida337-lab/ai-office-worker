import { parseExplicitStartTime } from "../services/calendar/datetime.js";
import { EVENT_SOURCES, isCompletionOutcome, isEventSource, type CompletionOutcome, type EventSource } from "../services/calendar/enums.js";

export const DEFAULT_CALENDAR_TIMEZONE = "Asia/Jerusalem";

export const CLIENT_ALLOWED_EVENT_SOURCES = new Set<EventSource>(
  EVENT_SOURCES.filter((source) => !["ai_chat", "system", "migration"].includes(source))
);

export const FORBIDDEN_CLIENT_EVENT_SOURCES = new Set<EventSource>(["ai_chat", "system", "migration"]);

export const FORBIDDEN_EVENT_PATCH_FIELDS = new Set([
  "status",
  "source",
  "googleEventId",
  "googleSyncStatus",
  "organizationId",
  "workCaseId",
  "legacyAppointmentId",
  "rescheduledFromId",
  "rescheduledToId",
  "completionNotes",
  "completionOutcome",
  "createdByUserId",
  "commandSessionId",
  "lastSyncedAt",
  "auditEntries",
  "timelineEntries",
]);

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 50;

export class CalendarEngineValidationError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CalendarEngineValidationError";
    this.code = code;
    this.details = details;
  }
}

export function parseIsoDateTime(value: unknown, fieldName: string): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", `${fieldName} is required`, {
      field: fieldName,
    });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", `Invalid ${fieldName}`, { field: fieldName });
  }
  return parsed;
}

export function parseOptionalIsoDateTime(value: unknown, fieldName: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseIsoDateTime(value, fieldName);
}

const NAIVE_WALL_CLOCK_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * מילישניות "אזרחיות" (Date.UTC על רכיבי שעון-הקיר) עבור מחרוזת נאיבית מלאה —
 * משמש רק לחישוב משך בין שתי מחרוזות נאיביות, לא לזיהוי רגע מוחלט.
 */
function naiveWallClockUtcMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) return null;
  const match = trimmed.match(NAIVE_WALL_CLOCK_REGEX);
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    match[6] !== undefined ? Number(match[6]) : 0
  );
}

/**
 * כמו parseIsoDateTime עבור מחרוזות עם Z/offset (התנהגות זהה לאחור), אבל
 * מחרוזת נאיבית מתפרשת כשעון-קיר ב-timezone של הארגון במקום בשל השרת.
 * timezone ריק/חסר נופל ל-Asia/Jerusalem.
 */
export function parseWallClockAwareDateTime(
  value: unknown,
  fieldName: string,
  timeZone?: string | null
): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", `${fieldName} is required`, {
      field: fieldName,
    });
  }
  const zone = timeZone?.trim() || DEFAULT_CALENDAR_TIMEZONE;
  const parsed = parseExplicitStartTime(value.trim(), zone);
  if (!parsed) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", `Invalid ${fieldName}`, { field: fieldName });
  }
  return parsed;
}

/**
 * כששני הקצוות נאיביים, endAt מחושב בשרת מ-startAt האמיתי + משך שעון-הקיר:
 * חוצה-חצות נתמך (המחרוזת נושאת תאריך מלא) ומשך של 60 דקות נשאר 60 דקות
 * אמיתיות גם כשהטווח חוצה מעבר DST. אחרת endAt מפוענח ישירות.
 */
function resolveRangeEndAt(
  startRaw: unknown,
  startAt: Date,
  endRaw: unknown,
  timeZone?: string | null
): Date {
  const startNaiveMs = naiveWallClockUtcMs(startRaw);
  const endNaiveMs = naiveWallClockUtcMs(endRaw);
  if (startNaiveMs !== null && endNaiveMs !== null) {
    return new Date(startAt.getTime() + (endNaiveMs - startNaiveMs));
  }
  return parseWallClockAwareDateTime(endRaw, "endAt", timeZone);
}

export function resolveEventTimeRange(
  startRaw: unknown,
  endRaw: unknown,
  timeZone?: string | null
): { startAt: Date; endAt: Date } {
  const startAt = parseWallClockAwareDateTime(startRaw, "startAt", timeZone);
  const endAt = resolveRangeEndAt(startRaw, startAt, endRaw, timeZone);
  validateEventTimeRange(startAt, endAt);
  return { startAt, endAt };
}

export function parseNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", `${fieldName} is required`, {
      field: fieldName,
    });
  }
  return value.trim();
}

export function parseOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", "Expected string value");
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function parsePaginationLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_PAGE_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", "limit must be a positive number");
  }
  return Math.min(Math.floor(parsed), MAX_PAGE_LIMIT);
}

export function parseDateRangeQuery(fromRaw: unknown, toRaw: unknown): { from: Date; to: Date } {
  const from = parseIsoDateTime(fromRaw, "from");
  const to = parseIsoDateTime(toRaw, "to");
  if (from.getTime() >= to.getTime()) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", "from must be before to", {
      field: "from",
    });
  }
  return { from, to };
}

export function validateEventTimeRange(startAt: Date, endAt: Date): void {
  if (startAt.getTime() >= endAt.getTime()) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", "startAt must be before endAt", {
      field: "startAt",
    });
  }
  if (endAt.getTime() - startAt.getTime() <= 0) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", "Event duration must be greater than zero", {
      field: "endAt",
    });
  }
}

export function parseClientEventSource(value: unknown): EventSource {
  const source = typeof value === "string" && value.trim() ? value.trim() : "manual";
  if (!isEventSource(source)) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", "Invalid event source", { field: "source" });
  }
  if (FORBIDDEN_CLIENT_EVENT_SOURCES.has(source)) {
    throw new CalendarEngineValidationError("FORBIDDEN", "Event source is not allowed from this API", {
      field: "source",
      source,
    });
  }
  return source;
}

export function rejectForbiddenPatchFields(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_EVENT_PATCH_FIELDS.has(key)) {
      throw new CalendarEngineValidationError("FORBIDDEN", `Field '${key}' cannot be updated via PATCH`, {
        field: key,
      });
    }
  }
}

export function rejectOrganizationIdInBody(body: Record<string, unknown>): void {
  if ("organizationId" in body) {
    throw new CalendarEngineValidationError("FORBIDDEN", "organizationId cannot be set in request body", {
      field: "organizationId",
    });
  }
}

export function pickAllowedPatchFields(body: Record<string, unknown>, timeZone?: string | null) {
  rejectForbiddenPatchFields(body);
  const startAt =
    body.startAt !== undefined ? parseWallClockAwareDateTime(body.startAt, "startAt", timeZone) : undefined;
  const endAt =
    body.endAt === undefined
      ? undefined
      : startAt !== undefined
        ? resolveRangeEndAt(body.startAt, startAt, body.endAt, timeZone)
        : parseWallClockAwareDateTime(body.endAt, "endAt", timeZone);
  return {
    title: parseOptionalString(body.title),
    startAt,
    endAt,
    clientId:
      body.clientId === undefined
        ? undefined
        : body.clientId === null
          ? null
          : parseNonEmptyString(body.clientId, "clientId"),
    assignedUserId:
      body.assignedUserId === undefined
        ? undefined
        : body.assignedUserId === null
          ? null
          : parseNonEmptyString(body.assignedUserId, "assignedUserId"),
    serviceId:
      body.serviceId === undefined
        ? undefined
        : body.serviceId === null
          ? null
          : parseNonEmptyString(body.serviceId, "serviceId"),
    internalNotes: parseOptionalString(body.internalNotes),
    locationType: parseOptionalString(body.locationType),
    address: parseOptionalString(body.address),
    remoteLink: parseOptionalString(body.remoteLink),
  };
}

export function parseCompletionOutcome(value: unknown, fieldName = "completionOutcome"): CompletionOutcome {
  if (typeof value !== "string" || !value.trim()) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", `${fieldName} is required`, {
      field: fieldName,
    });
  }
  const outcome = value.trim();
  if (!isCompletionOutcome(outcome)) {
    throw new CalendarEngineValidationError("VALIDATION_FAILED", `Invalid ${fieldName}`, {
      field: fieldName,
      value: outcome,
    });
  }
  return outcome;
}
