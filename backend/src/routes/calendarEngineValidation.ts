import { EVENT_SOURCES, isCompletionOutcome, isEventSource, type CompletionOutcome, type EventSource } from "../services/calendar/enums.js";

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

export function pickAllowedPatchFields(body: Record<string, unknown>) {
  rejectForbiddenPatchFields(body);
  return {
    title: parseOptionalString(body.title),
    startAt: body.startAt !== undefined ? parseIsoDateTime(body.startAt, "startAt") : undefined,
    endAt: body.endAt !== undefined ? parseIsoDateTime(body.endAt, "endAt") : undefined,
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
