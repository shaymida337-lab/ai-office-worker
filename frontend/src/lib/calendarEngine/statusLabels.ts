import type { CalendarEventStatus } from "./types";

const STATUS_LABELS: Record<CalendarEventStatus, string> = {
  draft: "טיוטה",
  pending_readiness: "ממתין לבדיקה",
  confirmed: "מאושר",
  completed: "הושלם",
  cancelled: "בוטל",
  no_show: "לא הגיע",
  rescheduled: "נדחה",
};

export function calendarEventStatusLabel(status: string): string {
  return STATUS_LABELS[status as CalendarEventStatus] ?? status;
}

export type StatusTone = "success" | "warn" | "danger" | "info" | "neutral";

export function calendarEventStatusTone(status: string): StatusTone {
  switch (status) {
    case "completed":
      return "success";
    case "confirmed":
      return "info";
    case "draft":
    case "pending_readiness":
      return "warn";
    case "cancelled":
      return "danger";
    case "no_show":
    case "rescheduled":
      return "neutral";
    default:
      return "neutral";
  }
}

export function isPendingOwnerApproval(status: string): boolean {
  return status === "pending_readiness";
}

export const PENDING_OWNER_APPROVAL_LABEL = "ממתין לאישורך";

export const CALENDAR_ENGINE_DISABLED_MESSAGE = "מנוע היומן החדש אינו פעיל כרגע";
