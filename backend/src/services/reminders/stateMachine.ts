import type { AttendanceState } from "./types.js";

const ALLOWED_TRANSITIONS: Record<AttendanceState, ReadonlySet<AttendanceState>> = {
  scheduled: new Set(["reminder_pending", "cancelled"]),
  reminder_pending: new Set(["reminder_sent", "cancelled"]),
  reminder_sent: new Set(["confirmed", "declined", "reschedule_requested", "no_response", "cancelled"]),
  confirmed: new Set(["arrived", "no_show", "cancelled"]),
  declined: new Set(["cancelled"]),
  reschedule_requested: new Set(["cancelled", "scheduled"]),
  no_response: new Set(["arrived", "no_show", "cancelled"]),
  arrived: new Set(),
  no_show: new Set(),
  cancelled: new Set(),
};

export function canTransitionAttendance(from: AttendanceState, to: AttendanceState): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function assertAttendanceTransition(from: AttendanceState, to: AttendanceState): void {
  if (!canTransitionAttendance(from, to)) {
    throw new Error(`Invalid attendance transition: ${from} -> ${to}`);
  }
}
