import type { Prisma } from "@prisma/client";
import type { EventSource } from "./enums.js";
import type { CalendarEventWithRelations } from "./calendarEventService.js";
import type { SuggestedSlot } from "./types.js";

/** Canonical scheduling request sources — every mutation must declare one. */
export const CALENDAR_ENGINE_SOURCES = [
  "ui",
  "natalie_ai",
  "whatsapp",
  "google_sync",
  "api",
  "automation",
] as const;

export type CalendarEngineSource = (typeof CALENDAR_ENGINE_SOURCES)[number];

export const CALENDAR_ENGINE_OPERATIONS = [
  "create",
  "update",
  "move",
  "cancel",
  "delete",
  "restore",
  "validate",
  "detect_conflicts",
] as const;

export type CalendarEngineOperation = (typeof CALENDAR_ENGINE_OPERATIONS)[number];

export const CALENDAR_VALIDATION_CODES = [
  "MISSING_REQUIRED_FIELD",
  "INVALID_TIME_RANGE",
  "OUTSIDE_WORKING_HOURS",
  "PAST_START_TIME",
  "BUFFER_VIOLATION",
  "INVALID_ATTENDEE",
  "DUPLICATE_REQUEST",
  "INVALID_STATUS_TRANSITION",
  "RESTORE_NOT_ALLOWED",
] as const;

export type CalendarValidationCode = (typeof CALENDAR_VALIDATION_CODES)[number];

export const CALENDAR_CONFLICT_TYPES = [
  "overlapping_meeting",
  "duplicate_meeting",
  "busy_resource",
  "blocked_time",
  "unavailable_calendar",
] as const;

export type CalendarConflictType = (typeof CALENDAR_CONFLICT_TYPES)[number];

export type FailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "forbidden"
  | "timeout"
  | "transient"
  | "permanent"
  | "idempotency"
  | "unknown";

export type CalendarValidationIssue = {
  code: CalendarValidationCode;
  field?: string;
  message: string;
};

export type CalendarValidationResult = {
  valid: boolean;
  issues: CalendarValidationIssue[];
};

export type CalendarConflictDetail = {
  type: CalendarConflictType;
  message: string;
  conflictId?: string;
  conflictSource?: string;
  clientName?: string;
  startTime?: string;
  endTime?: string;
};

export type CalendarConflictResult = {
  hasConflict: boolean;
  conflicts: CalendarConflictDetail[];
  suggestedSlots: SuggestedSlot[];
};

export type CalendarEngineActor = {
  actorType: "user" | "system" | "natalie";
  actorUserId?: string | null;
};

export type CalendarEngineEventInput = {
  title?: string | null;
  startAt: Date;
  endAt: Date;
  timezone?: string;
  workCaseId?: string;
  workCaseTitle?: string;
  clientId?: string | null;
  leadId?: string | null;
  assignedUserId?: string | null;
  serviceId?: string | null;
  source: EventSource;
  createdByUserId?: string | null;
  address?: string | null;
  prerequisitesJson?: Prisma.InputJsonValue;
};

export type CalendarEngineRequestContext = {
  organizationId: string;
  source: CalendarEngineSource;
  actor: CalendarEngineActor;
  correlationId?: string;
  idempotencyKey?: string | null;
  /** Route or module identifier for audit trail */
  sourceModule?: string;
  sourceRoute?: string;
  timeoutMs?: number;
  now?: Date;
};

export type CalendarEngineSuccess<T> = {
  ok: true;
  data: T;
  correlationId: string;
  durationMs: number;
  idempotentReplay?: boolean;
};

export type CalendarEngineFailure = {
  ok: false;
  code: string;
  message: string;
  classification: FailureClassification;
  correlationId: string;
  durationMs: number;
  validation?: CalendarValidationResult;
  conflict?: CalendarConflictResult;
  details?: Record<string, unknown>;
};

export type CalendarEngineOperationResult<T> = CalendarEngineSuccess<T> | CalendarEngineFailure;

export type CalendarEngineCreateResult = CalendarEventWithRelations;
export type CalendarEngineMoveResult = CalendarEventWithRelations & {
  decisionId?: string;
  queueType?: string;
};
export type CalendarEngineUpdateResult = CalendarEventWithRelations;
export type CalendarEngineCancelResult = { decisionId?: string; queueType?: string; status: string };
export type CalendarEngineDeleteResult = { calendarEventId: string; status: string };
export type CalendarEngineRestoreResult = CalendarEventWithRelations;

export function mapEventSourceToEngineSource(source: EventSource): CalendarEngineSource {
  switch (source) {
    case "whatsapp":
      return "whatsapp";
    case "ai_chat":
    case "voice":
      return "natalie_ai";
    case "email":
    case "booking_page":
      return "api";
    case "migration":
    case "system":
      return "automation";
    default:
      return "ui";
  }
}

export function mapEngineSourceToEventSource(source: CalendarEngineSource): EventSource {
  switch (source) {
    case "whatsapp":
      return "whatsapp";
    case "natalie_ai":
      return "ai_chat";
    case "google_sync":
      return "system";
    case "api":
      return "booking_page";
    case "automation":
      return "system";
    default:
      return "manual";
  }
}
