import type { CalendarEventStatus, DecisionQueueType, WorkCaseStatus } from "./enums.js";

const EVENT_STATUS_HE: Record<CalendarEventStatus, string> = {
  draft: "טיוטה",
  pending_readiness: "ממתין לבדיקות",
  confirmed: "מאושר",
  in_progress: "בביצוע",
  completed: "הושלם",
  cancelled: "בוטל",
  no_show: "לא הגיע",
  rescheduled: "נדחה לזמן אחר",
};

const WORK_CASE_STATUS_HE: Record<WorkCaseStatus, string> = {
  open: "פתוח",
  in_progress: "בטיפול",
  completed: "הושלם",
  cancelled: "בוטל",
};

const DECISION_TYPE_HE: Record<DecisionQueueType, string> = {
  confirm_appointment: "אישור תור",
  reschedule_appointment: "דחיית תור",
  cancel_appointment: "ביטול תור",
  create_invoice_placeholder: "בקשת חשבונית",
  send_follow_up_message: "הודעת מעקב",
  override_conflict: "עקיפת התנגשות",
};

export function hebrewEventStatus(status: CalendarEventStatus): string {
  return EVENT_STATUS_HE[status] ?? status;
}

export function hebrewWorkCaseStatus(status: WorkCaseStatus): string {
  return WORK_CASE_STATUS_HE[status] ?? status;
}

export function hebrewDecisionType(type: DecisionQueueType): string {
  return DECISION_TYPE_HE[type] ?? type;
}

export function summaryWorkCaseCreated(title: string): string {
  return `נפתח תיק עבודה: ${title}`;
}

export function summaryEventCreated(title?: string | null): string {
  return title?.trim() ? `נוצר אירוע: ${title.trim()}` : "נוצר אירוע חדש ביומן";
}

export function summaryEventStatusChanged(from: CalendarEventStatus, to: CalendarEventStatus): string {
  return `סטטוס האירוע השתנה מ-${hebrewEventStatus(from)} ל-${hebrewEventStatus(to)}`;
}

export function summaryWorkCaseStatusChanged(from: WorkCaseStatus, to: WorkCaseStatus): string {
  return `סטטוס התיק השתנה מ-${hebrewWorkCaseStatus(from)} ל-${hebrewWorkCaseStatus(to)}`;
}

export function summaryPrerequisitePassed(label: string): string {
  return `עבר תנאי מקדים: ${label}`;
}

export function summaryApprovalRequested(type: DecisionQueueType, title: string): string {
  return `ממתין לאישור — ${hebrewDecisionType(type)}: ${title}`;
}

export function summaryApprovalGranted(type: DecisionQueueType): string {
  return `אושר: ${hebrewDecisionType(type)}`;
}

export function summaryApprovalRejected(type: DecisionQueueType, note?: string | null): string {
  return note?.trim()
    ? `נדחה: ${hebrewDecisionType(type)} — ${note.trim()}`
    : `נדחה: ${hebrewDecisionType(type)}`;
}

export function summaryTaskSpawned(title: string): string {
  return `נוצרה משימת המשך: ${title}`;
}

export function summaryInvoiceRequested(): string {
  return "הוגשה בקשה לטיוטת חשבונית — לאישור בלבד";
}

export function summaryFollowUpMessageStub(): string {
  return "הודעת מעקב הוכנה — שליחה תידרש באישור עתידי";
}

export function summaryConflictDetected(clientName?: string): string {
  return clientName
    ? `זוהתה התנגשות בזמן עם ${clientName} — נדרש אישור לעקיפה`
    : "זוהתה התנגשות בזמן — נדרש אישור לעקיפה";
}

export function summaryGoogleSyncSuccess(operation: "create" | "update" | "delete"): string {
  if (operation === "delete") {
    return "האירוע הוסר מ-Google Calendar";
  }
  if (operation === "update") {
    return "האירוע עודכן ב-Google Calendar";
  }
  return "האירוע סונכרן ל-Google Calendar";
}

export function summaryGoogleSyncFailed(errorMessage?: string): string {
  return errorMessage?.trim()
    ? `סנכרון Google Calendar נכשל — ${errorMessage.trim()}`
    : "סנכרון Google Calendar נכשל";
}
