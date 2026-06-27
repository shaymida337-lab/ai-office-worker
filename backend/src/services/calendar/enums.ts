export const CALENDAR_EVENT_STATUSES = [
  "draft",
  "pending_readiness",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
] as const;

export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

export const EVENT_SOURCES = [
  "manual",
  "ai_chat",
  "voice",
  "whatsapp",
  "email",
  "booking_page",
  "migration",
  "system",
] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];

export const DECISION_QUEUE_TYPES = [
  "confirm_appointment",
  "reschedule_appointment",
  "cancel_appointment",
  "create_invoice_placeholder",
  "send_follow_up_message",
  "override_conflict",
] as const;

export type DecisionQueueType = (typeof DECISION_QUEUE_TYPES)[number];

export const DECISION_QUEUE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
] as const;

export type DecisionQueueStatus = (typeof DECISION_QUEUE_STATUSES)[number];

export const TIMELINE_ENTRY_TYPES = [
  "work_case_created",
  "event_created",
  "prerequisite_passed",
  "prerequisite_failed",
  "approval_requested",
  "approval_granted",
  "approval_rejected",
  "status_changed",
  "event_completed",
  "event_no_show",
  "event_cancelled",
  "event_rescheduled",
  "task_spawned",
  "invoice_requested",
  "google_sync_success",
  "google_sync_failed",
  "note_added",
  "natalie_command",
] as const;

export type TimelineEntryType = (typeof TIMELINE_ENTRY_TYPES)[number];

export const WORK_CASE_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;

export type WorkCaseStatus = (typeof WORK_CASE_STATUSES)[number];

export const COMPLETION_OUTCOMES = [
  "completed_success",
  "completed_early",
  "no_show",
  "cancelled_by_customer",
  "cancelled_by_business",
] as const;

export type CompletionOutcome = (typeof COMPLETION_OUTCOMES)[number];

export const GOOGLE_SYNC_STATUSES = ["skipped", "pending", "synced", "failed", "deleted"] as const;

export type GoogleSyncStatus = (typeof GOOGLE_SYNC_STATUSES)[number];

export const TASK_CALENDAR_SOURCES = ["post_event", "manual", "decision_rejected"] as const;

export type TaskCalendarSource = (typeof TASK_CALENDAR_SOURCES)[number];

export const DEFAULT_CALENDAR_AUTONOMY_JSON = {
  calendarAutonomy: {
    autoConfirmWhenFullyReady: false,
    autoSendFollowUp: false,
    autoSyncGoogleOnConfirm: true,
    autoCreateFollowUpTask: true,
  },
} as const;

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export function isCalendarEventStatus(value: string): value is CalendarEventStatus {
  return isOneOf(CALENDAR_EVENT_STATUSES, value);
}

export function isEventSource(value: string): value is EventSource {
  return isOneOf(EVENT_SOURCES, value);
}

export function isDecisionQueueType(value: string): value is DecisionQueueType {
  return isOneOf(DECISION_QUEUE_TYPES, value);
}

export function isDecisionQueueStatus(value: string): value is DecisionQueueStatus {
  return isOneOf(DECISION_QUEUE_STATUSES, value);
}

export function isTimelineEntryType(value: string): value is TimelineEntryType {
  return isOneOf(TIMELINE_ENTRY_TYPES, value);
}

export function isWorkCaseStatus(value: string): value is WorkCaseStatus {
  return isOneOf(WORK_CASE_STATUSES, value);
}

export function isCompletionOutcome(value: string): value is CompletionOutcome {
  return isOneOf(COMPLETION_OUTCOMES, value);
}

export function isGoogleSyncStatus(value: string): value is GoogleSyncStatus {
  return isOneOf(GOOGLE_SYNC_STATUSES, value);
}

export function isTaskCalendarSource(value: string): value is TaskCalendarSource {
  return isOneOf(TASK_CALENDAR_SOURCES, value);
}

export function assertEnumValue<T extends string>(
  label: string,
  values: readonly T[],
  value: string
): asserts value is T {
  if (!isOneOf(values, value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
