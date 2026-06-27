import type { WorkCaseStatus } from "./enums.js";
import { isWorkCaseStatus } from "./enums.js";
import { LifecycleError } from "./lifecycleErrors.js";

export const WORK_CASE_TERMINAL_STATUSES: ReadonlySet<WorkCaseStatus> = new Set(["completed", "cancelled"]);

const ALLOWED_TRANSITIONS: Record<WorkCaseStatus, readonly WorkCaseStatus[]> = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export type WorkCaseTransitionContext = {
  openCalendarEventCount?: number;
  openTaskCount?: number;
  allowManualClose?: boolean;
};

export function getAllowedWorkCaseTransitions(from: WorkCaseStatus): readonly WorkCaseStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransitionWorkCase(from: WorkCaseStatus, to: WorkCaseStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertWorkCaseTransition(from: string, to: string): void {
  if (!isWorkCaseStatus(from)) {
    throw new LifecycleError("INVALID_TRANSITION", `Unknown work case status: ${from}`, { from, to });
  }
  if (!isWorkCaseStatus(to)) {
    throw new LifecycleError("INVALID_TRANSITION", `Unknown work case status: ${to}`, { from, to });
  }
  if (!canTransitionWorkCase(from, to)) {
    throw new LifecycleError("INVALID_TRANSITION", `Cannot transition work case from ${from} to ${to}`, {
      from,
      to,
      allowed: ALLOWED_TRANSITIONS[from],
    });
  }
}

export function validateWorkCaseTransition(
  from: WorkCaseStatus,
  to: WorkCaseStatus,
  context: WorkCaseTransitionContext = {}
): void {
  assertWorkCaseTransition(from, to);

  if (to !== "completed") {
    return;
  }

  if (context.allowManualClose) {
    return;
  }

  const openEvents = context.openCalendarEventCount ?? 0;
  const openTasks = context.openTaskCount ?? 0;

  if (openEvents > 0 || openTasks > 0) {
    throw new LifecycleError(
      "VALIDATION_FAILED",
      "Work case cannot complete while calendar events or tasks remain open",
      { openCalendarEventCount: openEvents, openTaskCount: openTasks }
    );
  }
}

export function isWorkCaseTerminal(status: WorkCaseStatus): boolean {
  return WORK_CASE_TERMINAL_STATUSES.has(status);
}
