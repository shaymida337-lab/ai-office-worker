export type CalendarEventStatus =
  | "draft"
  | "pending_readiness"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

export type CalendarEngineClient = {
  id: string;
  name: string;
};

export type CalendarEngineService = {
  id: string;
  name: string;
  durationMinutes: number;
};

export type CalendarEngineWorkCase = {
  id: string;
  title: string;
  status: string;
};

export type CalendarPrerequisite = {
  id: string;
  label: string;
  required?: boolean;
  passed?: boolean;
};

export type CalendarEngineEvent = {
  id: string;
  status: CalendarEventStatus | string;
  startAt: string;
  endAt: string;
  title?: string | null;
  clientId?: string | null;
  serviceId?: string | null;
  workCaseId: string;
  prerequisitesJson?: unknown;
  completionNotes?: string | null;
  completionOutcome?: string | null;
  client?: CalendarEngineClient | null;
  service?: CalendarEngineService | null;
  workCase?: CalendarEngineWorkCase | null;
};

export type SubmitConfirmationResult =
  | { mode: "confirmed"; event: CalendarEngineEvent }
  | { mode: "queued"; decisionId: string; queueType: string };

export type OwnerDecisionQueueItem = {
  id: string;
  type: string;
  status: string;
  title: string;
  reason?: string | null;
  calendarEventId?: string | null;
  workCaseId?: string | null;
  createdAt: string;
  calendarEvent?: {
    id: string;
    status: string;
    title?: string | null;
    startAt: string;
    endAt: string;
  } | null;
  workCase?: { id: string; title: string } | null;
  preparedPayloadJson?: Record<string, unknown> | null;
};

export type WorkCaseTimelineEntry = {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
};

export type WorkCaseTimelineResponse = {
  items: WorkCaseTimelineEntry[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateCalendarEventInput = {
  startAt: string;
  endAt: string;
  clientId?: string | null;
  serviceId?: string | null;
  title?: string | null;
  workCaseTitle?: string | null;
  source?: string;
};
