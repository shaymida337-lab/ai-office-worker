import { natalieAppointmentMessage, nataliePaymentMessage, natalieReviewMessage, natalieScanMessage, natalieTaskMessage, inferReviewPresentation } from "./copy";
import type { NatalieActivityInput, NatalieTimelineItem } from "./types";

export function formatNatalieActivity(activity: NatalieActivityInput): NatalieTimelineItem {
  const text = activityLine(activity);
  return {
    id: activity.id,
    text,
    occurredAt: activity.occurredAt ?? undefined,
    kind: activity.kind,
  };
}

export function formatNatalieActivities(activities: NatalieActivityInput[]): NatalieTimelineItem[] {
  return activities.map(formatNatalieActivity);
}

function activityLine(activity: NatalieActivityInput): string {
  const ctx = {
    supplierName: activity.supplierName,
    clientName: activity.clientName,
    amount: activity.amount,
    currency: activity.currency,
  };

  switch (activity.kind) {
    case "invoice_saved": {
      const supplier = activity.supplierName?.trim() || activity.clientName?.trim() || "הספק";
      return `שמרתי חשבונית של ${supplier}.`;
    }
    case "payment_prepared":
      return nataliePaymentMessage("prepared", ctx);
    case "payment_paid":
      return nataliePaymentMessage("paid", ctx);
    case "task_created":
      return natalieTaskMessage(activity.title);
    case "appointment_scheduled":
      return natalieAppointmentMessage("scheduled", ctx);
    case "email_checked":
      return natalieScanMessage("finished");
    case "document_review":
      return natalieReviewMessage(
        inferReviewPresentation({ uncertaintyReason: activity.title }),
        ctx
      );
    case "scan_completed":
      return "סיימתי לעבור על המיילים ולשמור מה שמצאתי.";
    default:
      return activity.title?.trim() || "עדכנתי את העסק עבורך.";
  }
}
