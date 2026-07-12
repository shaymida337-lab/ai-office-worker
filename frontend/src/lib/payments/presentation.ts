import type { Payment } from "@/lib/api";
import { formatAmountValue } from "@/lib/format/amount";
import type { PaymentPresentation } from "./types";

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatPaymentAmount(payment: Payment) {
  const symbol = payment.currency === "ILS" || !payment.currency ? "₪" : payment.currency;
  return `${symbol}${formatAmountValue(payment.amount)}`;
}

export function formatPaymentDate(value: string | null | undefined) {
  if (!value) return "ללא תאריך יעד";
  return new Date(value).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

export function paymentDueKind(
  payment: Payment,
  now = new Date()
): "overdue" | "today" | "tomorrow" | "soon" | null {
  if (payment.paid || !payment.dueDate) return null;
  const due = new Date(payment.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const today = startOfDay(now).getTime();
  const dueDay = startOfDay(due).getTime();
  const tomorrow = today + 24 * 60 * 60 * 1000;
  if (dueDay < today) return "overdue";
  if (dueDay === today) return "today";
  if (dueDay === tomorrow) return "tomorrow";
  if (dueDay <= today + 3 * 24 * 60 * 60 * 1000) return "soon";
  return null;
}

export function supplierLabel(payment: Payment) {
  return payment.supplier?.trim() || "ספק לא ידוע";
}

export function presentPayment(payment: Payment, now = new Date()): PaymentPresentation {
  const supplier = supplierLabel(payment);
  const due = paymentDueKind(payment, now);

  if (payment.paid) {
    return {
      supplier,
      amountLabel: formatPaymentAmount(payment),
      dueLabel: formatPaymentDate(payment.dueDate ?? payment.date),
      reason: "התשלום הזה כבר סומן כשולם.",
      typeLabel: "שולם",
      urgent: false,
      primaryLabel: "פתחי מסמך",
      secondaryLabel: undefined,
      showAttach: false,
    };
  }

  if (payment.missingInvoice) {
    return {
      supplier,
      amountLabel: formatPaymentAmount(payment),
      dueLabel: formatPaymentDate(payment.dueDate ?? payment.date),
      reason: "יש תשלום בלי חשבונית — צריך לסגור את זה.",
      typeLabel: "חסרה חשבונית",
      urgent: due === "overdue" || due === "today",
      primaryLabel: "צרפי חשבונית",
      secondaryLabel: "פתחי מסמך",
      showAttach: true,
    };
  }

  if (due === "overdue") {
    return {
      supplier,
      amountLabel: formatPaymentAmount(payment),
      dueLabel: formatPaymentDate(payment.dueDate),
      reason: "התשלום הזה באיחור — כדאי לסגור אותו עכשיו.",
      typeLabel: "באיחור",
      urgent: true,
      primaryLabel: "אשרי תשלום",
      secondaryLabel: "פתחי מסמך",
      showAttach: false,
    };
  }

  if (due === "today") {
    return {
      supplier,
      amountLabel: formatPaymentAmount(payment),
      dueLabel: formatPaymentDate(payment.dueDate),
      reason: "התשלום אמור לצאת היום.",
      typeLabel: "להיום",
      urgent: true,
      primaryLabel: "אשרי תשלום",
      secondaryLabel: "פתחי מסמך",
      showAttach: false,
    };
  }

  if (due === "tomorrow") {
    return {
      supplier,
      amountLabel: formatPaymentAmount(payment),
      dueLabel: formatPaymentDate(payment.dueDate),
      reason: "התשלום אמור לצאת מחר.",
      typeLabel: "מחר",
      urgent: false,
      primaryLabel: "אשרי תשלום",
      secondaryLabel: "פתחי מסמך",
      showAttach: false,
    };
  }

  return {
    supplier,
    amountLabel: formatPaymentAmount(payment),
    dueLabel: formatPaymentDate(payment.dueDate ?? payment.date),
    reason: "הכנתי את התשלום — נשאר רק לאשר.",
    typeLabel: "ממתין",
    urgent: false,
    primaryLabel: "אשרי תשלום",
    secondaryLabel: "פתחי מסמך",
    showAttach: false,
  };
}

export function paymentPriority(payment: Payment, now = new Date()): number {
  if (payment.paid) return 99;
  const due = paymentDueKind(payment, now);
  if (due === "overdue") return 1;
  if (due === "today") return 2;
  if (due === "tomorrow") return 3;
  if (payment.missingInvoice) return 4;
  if (payment.amount >= 5000) return 5;
  return 6;
}

export function sortPaymentsForQueue(payments: Payment[], now = new Date()) {
  return [...payments]
    .filter((p) => !p.paid)
    .sort((a, b) => paymentPriority(a, now) - paymentPriority(b, now));
}

export function buildSnapshotMetrics(payments: Payment[]): {
  totalCount: number;
  totalAmountLabel: string;
  pendingCount: number;
} {
  const regular = payments.filter((p) => p.supplier?.trim());
  const pending = regular.filter((p) => !p.paid);
  const ilsTotal = regular.reduce((sum, p) => sum + (p.currency === "ILS" || !p.currency ? p.amount : 0), 0);
  return {
    totalCount: regular.length,
    totalAmountLabel: `₪${formatAmountValue(Math.round(ilsTotal))}`,
    pendingCount: pending.length,
  };
}

export function buildCompletedLines(stats: {
  preparedCount: number;
  markedPaid: number;
  attachedInvoices: number;
}) {
  const lines: string[] = [];
  if (stats.preparedCount > 0) {
    lines.push(
      stats.preparedCount === 1
        ? "הכנתי תשלום אחד"
        : `הכנתי ${stats.preparedCount} תשלומים`
    );
  }
  if (stats.markedPaid > 0) {
    lines.push(
      stats.markedPaid === 1
        ? "סימנתי תשלום אחד כשולם"
        : `סימנתי ${stats.markedPaid} כתשלומים שבוצעו`
    );
  }
  if (stats.attachedInvoices > 0) {
    lines.push(
      stats.attachedInvoices === 1
        ? "חיברתי חשבונית אחת"
        : `חיברתי ${stats.attachedInvoices} חשבוניות`
    );
  }
  return lines;
}

export function matchesPaymentSearch(payment: Payment, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    payment.supplier,
    payment.subject,
    payment.emailSender,
    String(payment.amount),
    formatPaymentAmount(payment),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes(q)) return true;
  if (q.includes("גדול") || q.includes("500")) return payment.amount >= 500;
  if (q.includes("דחוף") || q.includes("איחור")) return paymentDueKind(payment) === "overdue" || paymentDueKind(payment) === "today";
  if (q.includes("לא שולם") || q.includes("ממתין")) return !payment.paid;
  return false;
}

export function toDrivePreviewUrl(url: string) {
  return url.replace(/\/view(?:\?.*)?$/, "/preview");
}
