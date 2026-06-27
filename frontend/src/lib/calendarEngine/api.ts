import { apiFetch, ApiError } from "@/lib/api";
import type {
  CalendarEngineEvent,
  CreateCalendarEventInput,
  OwnerDecisionQueueItem,
  SubmitConfirmationResult,
  WorkCaseTimelineResponse,
} from "./types";

export class CalendarEngineUnavailableError extends Error {
  status = 503;

  constructor(message: string) {
    super(message);
    this.name = "CalendarEngineUnavailableError";
  }
}

function wrapCalendarEngineError(err: unknown): never {
  if (err instanceof ApiError && err.status === 503) {
    throw new CalendarEngineUnavailableError(err.message);
  }
  throw err;
}

export async function fetchCalendarEvents(from: string, to: string): Promise<CalendarEngineEvent[]> {
  try {
    return await apiFetch<CalendarEngineEvent[]>(
      `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function fetchCalendarEventById(id: string): Promise<CalendarEngineEvent> {
  try {
    return await apiFetch<CalendarEngineEvent>(`/api/calendar/events/${encodeURIComponent(id)}`);
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function createCalendarEventDraft(input: CreateCalendarEventInput): Promise<CalendarEngineEvent> {
  try {
    return await apiFetch<CalendarEngineEvent>("/api/calendar/events", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        source: input.source ?? "manual_ui",
      }),
    });
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function submitCalendarEventForConfirmation(eventId: string): Promise<SubmitConfirmationResult> {
  try {
    return await apiFetch<SubmitConfirmationResult>(
      `/api/calendar/events/${encodeURIComponent(eventId)}/submit-for-confirmation`,
      { method: "POST", body: JSON.stringify({}) }
    );
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function requestCalendarEventCancel(eventId: string): Promise<{ decisionId: string; queueType: string }> {
  try {
    return await apiFetch(`/api/calendar/events/${encodeURIComponent(eventId)}/request-cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function requestCalendarEventReschedule(
  eventId: string,
  input: { startAt: string; endAt: string }
): Promise<{ decisionId: string; queueType: string }> {
  try {
    return await apiFetch(`/api/calendar/events/${encodeURIComponent(eventId)}/request-reschedule`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export function requestDecisionUserMessage(): string {
  return "ממתין לאישורך";
}

export async function completeCalendarEvent(
  eventId: string,
  input: { completionNotes: string; completionOutcome: string }
): Promise<CalendarEngineEvent> {
  try {
    return await apiFetch<CalendarEngineEvent>(
      `/api/calendar/events/${encodeURIComponent(eventId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function markCalendarEventNoShow(
  eventId: string,
  input: { notes: string }
): Promise<CalendarEngineEvent> {
  try {
    return await apiFetch<CalendarEngineEvent>(
      `/api/calendar/events/${encodeURIComponent(eventId)}/no-show`,
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function fetchPendingOwnerDecisions(): Promise<OwnerDecisionQueueItem[]> {
  try {
    return await apiFetch<OwnerDecisionQueueItem[]>("/api/owner-decisions?status=pending");
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function approveOwnerDecision(id: string): Promise<unknown> {
  try {
    return await apiFetch(`/api/owner-decisions/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function rejectOwnerDecision(id: string): Promise<unknown> {
  try {
    return await apiFetch(`/api/owner-decisions/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export async function fetchWorkCaseTimeline(workCaseId: string): Promise<WorkCaseTimelineResponse> {
  try {
    return await apiFetch<WorkCaseTimelineResponse>(
      `/api/work-cases/${encodeURIComponent(workCaseId)}/timeline`
    );
  } catch (err) {
    wrapCalendarEngineError(err);
  }
}

export type CalendarLoadStrategy = "appointments" | "calendar_engine";

export function resolveCalendarLoadStrategy(readFlagEnabled: boolean): CalendarLoadStrategy {
  return readFlagEnabled ? "calendar_engine" : "appointments";
}

export type CalendarCreateStrategy = "appointment" | "calendar_engine_draft";

export function resolveCalendarCreateStrategy(writeFlagEnabled: boolean): CalendarCreateStrategy {
  return writeFlagEnabled ? "calendar_engine_draft" : "appointment";
}

export function submitConfirmationUserMessage(result: SubmitConfirmationResult): string {
  if (result.mode === "queued") {
    return "ממתין לאישורך";
  }
  if (result.event.status === "confirmed") {
    return "האירוע אושר";
  }
  return "האירוע נשלח לבדיקה";
}
