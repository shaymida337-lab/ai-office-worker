import {
  greetingForHour,
  inferReviewPresentation,
  natalieReviewMessage,
  natalieScanMessage,
} from "./copy";
import { resolvePrimaryAction } from "./primaryAction";
import type { NatalieBriefing, NatalieBriefingInput, NatalieBriefingItem } from "./types";

export function buildNatalieBriefing(input: NatalieBriefingInput): NatalieBriefing {
  const now = input.now ?? new Date();
  const greeting = greetingForHour(now, input.ownerFirstName);
  const completedItems = buildCompletedItems(input);
  const pendingItems = buildPendingItems(input);
  const pendingCount = pendingItems.length;

  const summary =
    pendingCount === 0
      ? "סיימתי לסדר את מה שיכולתי. אין כרגע דברים שדורשים החלטה מיידית."
      : pendingCount === 1
        ? "נשאר רק דבר אחד שצריך את ההחלטה שלך."
        : `נשארו ${pendingCount} דברים שצריך את ההחלטה שלך.`;

  const primaryAction = resolvePrimaryAction({
    screen: input.screen,
    documentReviewCount: input.documentReviews?.length ?? 0,
    unpaidPaymentCount: input.unpaidPayments?.length ?? 0,
    missingInvoiceCount: input.missingInvoices?.length ?? 0,
    pendingAppointmentCount: countPendingAppointments(input.upcomingAppointments, input.pendingSchedulingDecisions),
    pendingSchedulingDecisionCount: input.pendingSchedulingDecisions?.length ?? 0,
    primarySchedulingDecisionHref: input.pendingSchedulingDecisions?.[0]?.href,
    openTaskCount: input.openTasksCount ?? 0,
    scanRunning: input.scanRunning,
    gmailConnected: input.gmailConnected,
  });

  return {
    greeting,
    summary,
    completedItems,
    pendingItems,
    primaryAction,
    suggestedQuestions: suggestedQuestionsForScreen(input.screen, pendingCount),
  };
}

function buildCompletedItems(input: NatalieBriefingInput): NatalieBriefingItem[] {
  const items: NatalieBriefingItem[] = [];

  if (input.gmailConnected) {
    items.push({ id: "emails", text: input.scanRunning ? natalieScanMessage("checking_email") : "בדקתי את המיילים שלך" });
  }

  if ((input.invoicesSaved ?? 0) > 0) {
    const count = input.invoicesSaved ?? 0;
    items.push({
      id: "invoices",
      text: count === 1 ? "שמרתי חשבונית" : `שמרתי ${count} חשבוניות`,
    });
  }

  if ((input.paymentsPrepared ?? 0) > 0) {
    const count = input.paymentsPrepared ?? 0;
    items.push({
      id: "payments",
      text: count === 1 ? "הכנתי תשלום" : `הכנתי ${count} תשלומים`,
    });
  }

  if ((input.upcomingAppointments?.length ?? 0) > 0) {
    items.push({ id: "meetings", text: "סידרתי את הפגישות שלך" });
  }

  if (items.length === 0 && !input.scanRunning && !input.scanStale) {
    items.push({ id: "ready", text: "אני מוכנה לעבוד עבורך" });
  }

  if (input.scanStale) {
    items.push({ id: "scan-stale", text: natalieScanMessage("unfinished") });
  }

  return items;
}

function buildPendingItems(input: NatalieBriefingInput): NatalieBriefingItem[] {
  const items: NatalieBriefingItem[] = [];

  for (const review of input.documentReviews ?? []) {
    const presentation = inferReviewPresentation(review);
    items.push({
      id: `review-${review.id}`,
      text: natalieReviewMessage(presentation, {
        supplierName: review.supplierName,
        uncertaintyReason: review.uncertaintyReason,
      }).replace(/\n/g, " "),
    });
  }

  for (const payment of input.unpaidPayments ?? []) {
    items.push({
      id: `payment-${payment.id}`,
      text: `הכנתי תשלום ל${payment.supplier?.trim() || "ספק"} שממתין לאישור שלך.`,
    });
  }

  for (const missing of input.missingInvoices ?? []) {
    items.push({
      id: `missing-${missing.id}`,
      text: `יש תשלום ל${missing.supplier?.trim() || "ספק"} בלי חשבונית.`,
    });
  }

  for (const appointment of input.upcomingAppointments ?? []) {
    const pendingLegacy = (appointment.status ?? "").toLowerCase() === "pending";
    const pendingEngine = appointment.pendingOwnerApproval === true;
    if (pendingLegacy || pendingEngine) {
      items.push({
        id: `appt-${appointment.id}`,
        text: pendingEngine
          ? `יש תור עם ${appointment.clientName?.trim() || "לקוח"} — ממתין לאישורך.`
          : `יש פגישה עם ${appointment.clientName?.trim() || "לקוח"} שצריך לאשר.`,
      });
    }
  }

  for (const decision of input.pendingSchedulingDecisions ?? []) {
    items.push({
      id: `sched-decision-${decision.id}`,
      text: `${decision.typeLabel}: ${decision.title} — ממתין לאישורך.`,
    });
  }

  if ((input.openTasksCount ?? 0) > 0) {
    items.push({
      id: "tasks",
      text: `יש ${input.openTasksCount} משימות פתוחות שכדאי לסגור.`,
    });
  }

  return items.slice(0, 8);
}

function countPendingAppointments(
  appointments: NatalieBriefingInput["upcomingAppointments"],
  pendingDecisions?: NatalieBriefingInput["pendingSchedulingDecisions"]
): number {
  const legacyPending = (appointments ?? []).filter((a) => (a.status ?? "").toLowerCase() === "pending").length;
  const enginePending = (appointments ?? []).filter((a) => a.pendingOwnerApproval).length;
  const decisionPending = pendingDecisions?.length ?? 0;
  return Math.max(legacyPending, enginePending, decisionPending);
}

function suggestedQuestionsForScreen(screen: NatalieBriefingInput["screen"], pendingCount: number): string[] {
  if (pendingCount > 0) {
    return ["מה הדחוף ביותר?", "תראי לי מה ממתין", "בוא נתחיל מהראשון"];
  }

  switch (screen) {
    case "payments":
      return ["מה שולם החודש?", "מה ממתין לתשלום?", "הראי תשלומים לשבוע"];
    case "documents":
      return ["מה נכנס היום?", "יש משהו שחסר?", "מה ממתין לאישור?"];
    case "calendar":
      return ["מה יש מחר?", "קבעי פגישה חדשה", "מה השבוע שלי?"];
    default:
      return ["מה עשית היום?", "מה חסר לי?", "הראי תשלומים השבוע"];
  }
}

export function buildQuietSummary(input: NatalieBriefingInput): { id: string; label: string; value: string }[] {
  return [
    {
      id: "reviews",
      label: "ממתינים לאישור",
      value: String(input.documentReviews?.length ?? 0),
    },
    {
      id: "payments",
      label: "תשלומים החודש",
      value: String((input.unpaidPayments?.length ?? 0) + (input.missingInvoices?.length ?? 0)),
    },
    {
      id: "tasks",
      label: "משימות פתוחות",
      value: String(input.openTasksCount ?? 0),
    },
    {
      id: "meetings",
      label: "פגישות קרובות",
      value: String(input.upcomingAppointments?.length ?? 0),
    },
    {
      id: "scheduling-decisions",
      label: "החלטות יומן",
      value: String(input.pendingSchedulingDecisions?.length ?? 0),
    },
  ].filter((chip) => chip.id !== "scheduling-decisions" || chip.value !== "0");
}
