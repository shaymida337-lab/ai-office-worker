import type { CalendarEventStatus, DecisionQueueStatus } from "./enums.js";
import { isDecisionQueueStatus } from "./enums.js";
import { isCalendarEventTerminal } from "./calendarEventLifecycle.js";
import { LifecycleError } from "./lifecycleErrors.js";

export const DECISION_QUEUE_TERMINAL_STATUSES: ReadonlySet<DecisionQueueStatus> = new Set([
  "approved",
  "rejected",
  "expired",
  "superseded",
]);

const ALLOWED_TRANSITIONS: Record<DecisionQueueStatus, readonly DecisionQueueStatus[]> = {
  pending: ["approved", "rejected", "superseded", "expired"],
  approved: [],
  rejected: [],
  expired: [],
  superseded: [],
};

export type DecisionQueueTransitionContext = {
  calendarEventStatus?: CalendarEventStatus | null;
  alreadyExecuted?: boolean;
};

export function getAllowedDecisionQueueTransitions(
  from: DecisionQueueStatus
): readonly DecisionQueueStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransitionDecisionQueue(from: DecisionQueueStatus, to: DecisionQueueStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertDecisionQueueTransition(from: string, to: string): void {
  if (!isDecisionQueueStatus(from)) {
    throw new LifecycleError("INVALID_TRANSITION", `Unknown decision queue status: ${from}`, { from, to });
  }
  if (!isDecisionQueueStatus(to)) {
    throw new LifecycleError("INVALID_TRANSITION", `Unknown decision queue status: ${to}`, { from, to });
  }
  if (!canTransitionDecisionQueue(from, to)) {
    throw new LifecycleError("INVALID_TRANSITION", `Cannot transition decision queue item from ${from} to ${to}`, {
      from,
      to,
      allowed: ALLOWED_TRANSITIONS[from],
    });
  }
}

export function validateDecisionQueueApprove(
  from: DecisionQueueStatus,
  context: DecisionQueueTransitionContext = {}
): void {
  assertDecisionQueueTransition(from, "approved");

  if (context.alreadyExecuted) {
    return;
  }

  const eventStatus = context.calendarEventStatus;
  if (eventStatus && isCalendarEventTerminal(eventStatus)) {
    throw new LifecycleError("STALE_DECISION", "Cannot approve decision for a terminal calendar event", {
      calendarEventStatus: eventStatus,
    });
  }
}

export function validateDecisionQueueReject(from: DecisionQueueStatus): void {
  assertDecisionQueueTransition(from, "rejected");
}

export function validateDecisionQueueSupersede(from: DecisionQueueStatus): void {
  assertDecisionQueueTransition(from, "superseded");
}

export function isDecisionQueueTerminal(status: DecisionQueueStatus): boolean {
  return DECISION_QUEUE_TERMINAL_STATUSES.has(status);
}
