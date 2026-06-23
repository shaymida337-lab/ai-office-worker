import type { Payment } from "@/lib/api";
import { paymentDueKind, supplierLabel } from "./presentation";
import type { PaymentRecommendation } from "./types";

const LARGE_AMOUNT_THRESHOLD = 5000;

export function resolvePaymentRecommendation(
  payments: Payment[],
  now = new Date()
): PaymentRecommendation {
  const unpaid = payments.filter((p) => !p.paid);

  if (unpaid.length === 0) {
    return {
      kind: "all_clear",
      title: "סיימתי להכין את כל התשלומים שלך",
      reason: "אין כרגע תשלומים שמחכים לך.",
      ctaLabel: "הראי לי מה עודכן",
    };
  }

  const overdue = unpaid.find((p) => paymentDueKind(p, now) === "overdue");
  if (overdue) {
    const supplier = supplierLabel(overdue);
    return {
      kind: "overdue",
      title: `כדאי לסגור קודם את ${supplier}`,
      reason: "התשלום הזה באיחור.",
      ctaLabel: "שלמי עכשיו",
      paymentId: overdue.id,
    };
  }

  const today = unpaid.find((p) => paymentDueKind(p, now) === "today");
  if (today) {
    const supplier = supplierLabel(today);
    return {
      kind: "today",
      title: `אני ממליצה לשלם קודם את ${supplier}`,
      reason: "התשלום אמור לצאת היום.",
      ctaLabel: "שלמי עכשיו",
      paymentId: today.id,
    };
  }

  const tomorrow = unpaid.find((p) => paymentDueKind(p, now) === "tomorrow");
  if (tomorrow) {
    const supplier = supplierLabel(tomorrow);
    return {
      kind: "tomorrow",
      title: `מחר יוצא תשלום ל${supplier}`,
      reason: "כדאי לסגור את זה עכשיו ולהיות רגוע.",
      ctaLabel: "שלמי עכשיו",
      paymentId: tomorrow.id,
    };
  }

  const missing = unpaid.find((p) => p.missingInvoice);
  if (missing) {
    const supplier = supplierLabel(missing);
    return {
      kind: "missing_invoice",
      title: `חסרה חשבונית ל${supplier}`,
      reason: "בלי החשבונית אני לא יכולה לסגור את התשלום.",
      ctaLabel: "צרפי חשבונית",
      paymentId: missing.id,
    };
  }

  const large = unpaid.find((p) => p.amount >= LARGE_AMOUNT_THRESHOLD);
  if (large) {
    const supplier = supplierLabel(large);
    return {
      kind: "large",
      title: `יש תשלום גדול ל${supplier}`,
      reason: "כדאי לוודא לפני שמסמנים כשולם.",
      ctaLabel: "שלמי עכשיו",
      paymentId: large.id,
    };
  }

  const first = unpaid[0];
  const supplier = supplierLabel(first);
  return {
    kind: "unpaid",
    title: `יש ${unpaid.length === 1 ? "תשלום אחד" : `${unpaid.length} תשלומים`} שמחכים לך`,
    reason: `נתחיל עם ${supplier}?`,
    ctaLabel: "שלמי עכשיו",
    paymentId: first.id,
  };
}

export function remainingPaymentsMessage(count: number) {
  if (count === 0) return "סיימנו — אין עוד תשלומים ממתינים.";
  if (count === 1) return "נשאר עוד תשלום אחד.";
  if (count === 2) return "נשארו עוד שני תשלומים.";
  return `נשארו עוד ${count} תשלומים.`;
}
