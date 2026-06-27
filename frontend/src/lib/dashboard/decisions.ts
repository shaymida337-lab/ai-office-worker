import { inferReviewPresentation } from "@/lib/natalie/copy";
import type { DashboardStats } from "@/lib/api";

export type DecisionKind =
  | "urgent_payment"
  | "payment"
  | "blocked_review"
  | "document_review"
  | "missing_invoice"
  | "appointment"
  | "scheduling_decision"
  | "alert";

export type DecisionCardData = {
  id: string;
  kind: DecisionKind;
  typeLabel: string;
  title: string;
  description: string;
  meta?: string;
  urgent: boolean;
  primaryLabel: string;
  secondaryLabel?: string;
  href?: string;
  paymentId?: string;
  priority: number;
};

type PaymentLike = {
  id: string;
  supplier: string | null;
  paid: boolean;
  amount: number;
  currency?: string;
  date: string;
  missingInvoice?: boolean;
};

type ReviewLike = {
  id: string;
  supplierName: string | null;
  reviewStatus: string;
  uncertaintyReason: string | null;
  documentType: string;
  totalAmount: number | null;
  currency?: string | null;
  documentDate?: string | null;
  createdAt: string;
};

type AlertLike = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
};

type AppointmentLike = {
  id: string;
  clientName: string;
  startTime: string;
  status: string;
  source?: "appointment" | "calendar_event";
  pendingOwnerApproval?: boolean;
};

type SchedulingDecisionLike = {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  reason?: string | null;
  createdAt: string;
  href: string;
};

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function paymentDueLabel(dateStr: string | null | undefined, now: Date): "today" | "tomorrow" | "soon" | null {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  if (Number.isNaN(due.getTime())) return null;
  const today = startOfDay(now).getTime();
  const dueDay = startOfDay(due).getTime();
  const tomorrow = today + 24 * 60 * 60 * 1000;
  if (dueDay <= today) return "today";
  if (dueDay === tomorrow) return "tomorrow";
  if (dueDay <= today + 3 * 24 * 60 * 60 * 1000) return "soon";
  return null;
}

function formatMoney(amount: number, currency = "ILS") {
  if (currency === "ILS") return `₪${Math.round(amount).toLocaleString("he-IL")}`;
  return `${currency} ${Math.round(amount).toLocaleString("he-IL")}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function supplierLabel(name?: string | null) {
  return name?.trim() || "ספק לא ידוע";
}

function reviewDecisionCopy(review: ReviewLike) {
  const supplier = supplierLabel(review.supplierName);
  const presentation = inferReviewPresentation(review);

  switch (presentation) {
    case "ambiguous_supplier":
      return {
        typeLabel: "ספק לא ברור",
        title: supplier,
        description: "אני צריכה שתעזור לי לבחור ספק",
        primaryLabel: "עזרי לי לבחור",
        secondaryLabel: "פתחי מסמך",
        priority: 3,
        kind: "blocked_review" as const,
        urgent: true,
      };
    case "missing_details":
      return {
        typeLabel: "חסרים פרטים",
        title: supplier,
        description: "חסרים פרטים קטנים — אחרי זה אסגור את המסמך",
        primaryLabel: "השלימי פרטים",
        secondaryLabel: "פתחי מסמך",
        priority: 2,
        kind: "blocked_review" as const,
        urgent: true,
      };
    default:
      return {
        typeLabel: "מסמך לאישור",
        title: supplier,
        description: "אני צריכה שתאשרי את המסמך הזה",
        primaryLabel: "אשרי",
        secondaryLabel: "פתחי מסמך",
        priority: 5,
        kind: "document_review" as const,
        urgent: false,
      };
  }
}

export function buildDecisionItems(
  reviews: ReviewLike[],
  missing: PaymentLike[],
  allPayments: PaymentLike[],
  alerts: AlertLike[],
  appointments: AppointmentLike[],
  schedulingDecisions: SchedulingDecisionLike[] = [],
  now = new Date()
): DecisionCardData[] {
  const items: DecisionCardData[] = [];

  for (const payment of allPayments.filter((p) => !p.paid)) {
    const due = paymentDueLabel(payment.date, now);
    if (due === "today" || due === "tomorrow") {
      items.push({
        id: `urgent-${payment.id}`,
        kind: "urgent_payment",
        typeLabel: "תשלום דחוף",
        title: supplierLabel(payment.supplier),
        description: due === "today" ? "התשלום אמור לצאת היום" : "התשלום אמור לצאת מחר",
        meta: formatMoney(payment.amount, payment.currency),
        urgent: true,
        primaryLabel: "אשרי",
        secondaryLabel: "פתחי תשלום",
        href: "/payments",
        paymentId: payment.id,
        priority: 1,
      });
    }
  }

  for (const review of reviews) {
    const copy = reviewDecisionCopy(review);
    items.push({
      id: `review-${review.id}`,
      ...copy,
      meta: `${formatMoney(review.totalAmount ?? 0, review.currency ?? "ILS")} · ${formatDate(review.documentDate ?? review.createdAt)}`,
      href: "/dashboard/document-reviews",
    });
  }

  for (const payment of missing) {
    items.push({
      id: `missing-${payment.id}`,
      kind: "missing_invoice",
      typeLabel: "חסרה חשבונית",
      title: supplierLabel(payment.supplier),
      description: "מצאתי תשלום אבל חסרה חשבונית",
      meta: formatDate(payment.date),
      urgent: false,
      primaryLabel: "העלי חשבונית",
      secondaryLabel: "פתחי תשלום",
      href: "/payments",
      paymentId: payment.id,
      priority: 4,
    });
  }

  for (const payment of allPayments.filter((p) => !p.paid && !paymentDueLabel(p.date, now))) {
    if (items.some((i) => i.paymentId === payment.id)) continue;
    items.push({
      id: `payment-${payment.id}`,
      kind: "payment",
      typeLabel: "תשלום ממתין",
      title: supplierLabel(payment.supplier),
      description: "תשלום שמחכה לאישור שלך",
      meta: formatMoney(payment.amount, payment.currency),
      urgent: false,
      primaryLabel: "אשרי",
      secondaryLabel: "פתחי תשלום",
      href: "/payments",
      paymentId: payment.id,
      priority: 6,
    });
  }

  for (const decision of schedulingDecisions) {
    items.push({
      id: `sched-decision-${decision.id}`,
      kind: "scheduling_decision",
      typeLabel: decision.typeLabel,
      title: decision.title,
      description: decision.reason?.trim() || "ממתין לאישורך",
      meta: formatDate(decision.createdAt),
      urgent: false,
      primaryLabel: "אשרי",
      secondaryLabel: "פתחי יומן",
      href: decision.href,
      priority: 6,
    });
  }

  for (const appt of appointments.filter((a) => {
    const legacyPending = (a.status ?? "").toLowerCase() === "pending";
    const enginePending = a.pendingOwnerApproval === true;
    return legacyPending || enginePending;
  })) {
    const engineItem = appt.source === "calendar_event" || appt.pendingOwnerApproval;
    items.push({
      id: `appt-${appt.id}`,
      kind: "appointment",
      typeLabel: "פגישה",
      title: appt.clientName?.trim() || "לקוח",
      description: engineItem ? "ממתין לאישורך" : "פגישה שצריך לאשר",
      meta: formatDate(appt.startTime),
      urgent: false,
      primaryLabel: "אשרי",
      secondaryLabel: "פתחי יומן",
      href: engineItem ? "/dashboard/calendar" : "/dashboard/calendar",
      priority: 7,
    });
  }

  for (const alert of alerts) {
    items.push({
      id: `alert-${alert.id}`,
      kind: "alert",
      typeLabel: "דורש תשומת לב",
      title: alert.title,
      description: alert.body?.trim() || "משהו דורש בדיקה קצרה",
      meta: formatDate(alert.createdAt),
      urgent: alert.type === "error",
      primaryLabel: "סמני כטופל",
      secondaryLabel: "פרטים",
      priority: 8,
    });
  }

  return items.sort((a, b) => a.priority - b.priority).slice(0, 12);
}

export function countUrgentDecisions(items: DecisionCardData[]) {
  return items.filter((item) => item.urgent).length;
}

export function buildHeroChips(
  doneCount: number,
  pendingCount: number,
  urgentCount: number
): Array<{ id: string; label: string; tone: "green" | "orange" | "red" | "neutral" }> {
  const chips: Array<{ id: string; label: string; tone: "green" | "orange" | "red" | "neutral" }> = [];

  if (doneCount > 0) {
    chips.push({
      id: "done",
      label: doneCount === 1 ? "פעולה אחת בוצעה" : `${doneCount} פעולות בוצעו`,
      tone: "green",
    });
  }

  if (pendingCount > 0) {
    chips.push({
      id: "pending",
      label: pendingCount === 1 ? "דבר אחד מחכה לאישור" : `${pendingCount} דברים מחכים לאישור`,
      tone: "orange",
    });
  }

  if (urgentCount > 0) {
    chips.push({
      id: "urgent",
      label: urgentCount === 1 ? "1 דחוף" : `${urgentCount} דחופים`,
      tone: "red",
    });
  }

  if (chips.length === 0) {
    chips.push({ id: "calm", label: "הכול שקט היום", tone: "neutral" });
  }

  return chips.slice(0, 3);
}

export function buildSnapshotMetrics(stats: DashboardStats | null, input: {
  monthPayments: number;
  pendingReviews: number;
  recentInvoices: number;
}) {
  const currency = stats?.currency ?? "ILS";
  const moneyLabel =
    currency === "ILS"
      ? `₪${Math.round(stats?.moneyToPay ?? 0).toLocaleString("he-IL")}`
      : `${Math.round(stats?.moneyToPay ?? 0).toLocaleString("he-IL")} ${currency}`;

  return [
    {
      id: "month-payments",
      label: "תשלומים החודש",
      value: String(input.monthPayments),
      hint: input.monthPayments === 0 ? "עדיין לא נקלטו החודש" : "נקלטו החודש",
      accent: "blue" as const,
    },
    {
      id: "pending-docs",
      label: "מסמכים לאישור",
      value: String(input.pendingReviews),
      hint: input.pendingReviews === 0 ? "אין מסמכים ממתינים" : "מחכים לאישור שלך",
      accent: "orange" as const,
    },
    {
      id: "invoices",
      label: "חשבוניות שנקלטו",
      value: String(input.recentInvoices || stats?.totalInvoices || 0),
      hint: "במערכת",
      accent: "green" as const,
    },
    {
      id: "cashflow",
      label: "לתשלום החודש",
      value: moneyLabel,
      hint: stats?.moneyToReceive ? `₪${Math.round(stats.moneyToReceive).toLocaleString("he-IL")} לגבייה` : "מצב שוטף",
      accent: "purple" as const,
    },
  ];
}

export function buildWorkSummaryLines(input: {
  scanLastSaved?: number;
  monthPayments: number;
  monthInvoices: number;
  upcomingMeetings: number;
  pendingReviews: number;
  gmailConnected: boolean;
  scanRunning: boolean;
}): string[] {
  const lines: string[] = [];

  if (input.scanRunning) {
    lines.push("אני עדיין סורקת מסמכים בשבילך");
  } else if (input.gmailConnected && (input.monthInvoices > 0 || (input.scanLastSaved ?? 0) > 0)) {
    const count = input.monthInvoices || input.scanLastSaved || 0;
    lines.push(count === 1 ? "סרקתי חשבונית אחת" : `סרקתי ${count} חשבוניות`);
  }

  if (input.monthPayments > 0) {
    lines.push(input.monthPayments === 1 ? "הכנסתי תשלום אחד" : `הכנסתי ${input.monthPayments} תשלומים`);
  }

  if (input.upcomingMeetings > 0) {
    lines.push("סידרתי את הפגישות שלך");
  }

  if (input.pendingReviews > 0) {
    lines.push(
      input.pendingReviews === 1
        ? "מצאתי מסמך שחסרים בו פרטים"
        : `מצאתי ${input.pendingReviews} מסמכים שצריכים אותך`
    );
  }

  if (lines.length === 0) {
    lines.push("אני מוכנה לעבוד — תגיד לי מה לעשות");
  }

  return lines.slice(0, 4);
}
