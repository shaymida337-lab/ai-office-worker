import type { CalendarEventStatus, CompletionOutcome } from "./enums.js";
import { isCalendarEventStatus } from "./enums.js";
import { LifecycleError } from "./lifecycleErrors.js";

export const CALENDAR_EVENT_TERMINAL_STATUSES: ReadonlySet<CalendarEventStatus> = new Set([
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
]);

/** Reserved in V1 — no outbound transitions defined. */
export const CALENDAR_EVENT_V11_RESERVED_STATUSES: ReadonlySet<CalendarEventStatus> = new Set(["in_progress"]);

const ALLOWED_TRANSITIONS: Record<CalendarEventStatus, readonly CalendarEventStatus[]> = {
  draft: ["pending_readiness", "cancelled"],
  pending_readiness: ["confirmed", "draft", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled", "rescheduled"],
  in_progress: [],
  completed: [],
  cancelled: [],
  no_show: [],
  rescheduled: [],
};

export type CalendarEventTransitionContext = {
  now?: Date;
  startAt?: Date;
  workCaseId?: string | null;
  clientId?: string | null;
  eventType?: string;
  completionNotes?: string | null;
  completionOutcome?: CompletionOutcome | null;
  noShowGraceMinutes?: number;
};

export function getAllowedCalendarEventTransitions(
  from: CalendarEventStatus
): readonly CalendarEventStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransitionCalendarEvent(from: CalendarEventStatus, to: CalendarEventStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertCalendarEventTransition(from: string, to: string): void {
  if (!isCalendarEventStatus(from)) {
    throw new LifecycleError("INVALID_TRANSITION", `Unknown calendar event status: ${from}`, {
      from,
      to,
    });
  }
  if (!isCalendarEventStatus(to)) {
    throw new LifecycleError("INVALID_TRANSITION", `Unknown calendar event status: ${to}`, {
      from,
      to,
    });
  }
  if (!canTransitionCalendarEvent(from, to)) {
    throw new LifecycleError("INVALID_TRANSITION", `Cannot transition calendar event from ${from} to ${to}`, {
      from,
      to,
      allowed: ALLOWED_TRANSITIONS[from],
    });
  }
}

export function validateCalendarEventTransition(
  from: CalendarEventStatus,
  to: CalendarEventStatus,
  context: CalendarEventTransitionContext = {}
): void {
  assertCalendarEventTransition(from, to);

  const now = context.now ?? new Date();
  const graceMinutes = context.noShowGraceMinutes ?? 0;

  if (to === "pending_readiness") {
    if (!context.startAt) {
      throw new LifecycleError("VALIDATION_FAILED", "startAt is required to enter pending_readiness", {
        field: "startAt",
      });
    }
    if (!context.workCaseId) {
      throw new LifecycleError("VALIDATION_FAILED", "workCaseId is required to enter pending_readiness", {
        field: "workCaseId",
      });
    }
    if (context.eventType === "appointment" && !context.clientId) {
      throw new LifecycleError("VALIDATION_FAILED", "clientId is required for appointment events", {
        field: "clientId",
      });
    }
  }

  if (to === "completed") {
    if (from !== "confirmed") {
      throw new LifecycleError("VALIDATION_FAILED", "Only confirmed events can be completed", { from, to });
    }
    if (!context.completionNotes?.trim()) {
      throw new LifecycleError("VALIDATION_FAILED", "completionNotes is required to complete an event", {
        field: "completionNotes",
      });
    }
    if (!context.completionOutcome) {
      throw new LifecycleError("VALIDATION_FAILED", "completionOutcome is required to complete an event", {
        field: "completionOutcome",
      });
    }
    if (context.startAt && context.startAt.getTime() > now.getTime()) {
      throw new LifecycleError("VALIDATION_FAILED", "Cannot complete an event before its start time", {
        field: "startAt",
      });
    }
  }

  if (to === "no_show") {
    if (from !== "confirmed") {
      throw new LifecycleError("VALIDATION_FAILED", "Only confirmed events can be marked no_show", { from, to });
    }
    if (!context.startAt) {
      throw new LifecycleError("VALIDATION_FAILED", "startAt is required to mark no_show", { field: "startAt" });
    }
    const graceMs = graceMinutes * 60_000;
    if (now.getTime() < context.startAt.getTime() + graceMs) {
      throw new LifecycleError("VALIDATION_FAILED", "Cannot mark no_show before start time plus grace period", {
        field: "startAt",
      });
    }
  }
}

export function isCalendarEventTerminal(status: CalendarEventStatus): boolean {
  return CALENDAR_EVENT_TERMINAL_STATUSES.has(status);
}
