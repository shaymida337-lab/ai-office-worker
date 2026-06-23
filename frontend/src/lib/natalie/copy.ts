import type { NatalieCopyContext } from "./types.js";

/** Customer-facing language only. Never expose engine or pipeline terminology. */
export const FORBIDDEN_CUSTOMER_TERMS = [
  "ocr",
  "scfc",
  "arc",
  "sir",
  "fse",
  "trust",
  "outcome",
  "pipeline",
  "confidence",
  "sync",
  "processing",
  "completed",
  "needs_review",
  "duplicate_detected",
  "golden",
  "verification",
] as const;

export type NatalieScanPresentation = "checking_email" | "finished" | "unfinished" | "idle";

export type NatalieReviewPresentation =
  | "ambiguous_supplier"
  | "needs_confirmation"
  | "missing_details"
  | "ready_to_approve"
  | "already_handled";

export function greetingForHour(now: Date, firstName?: string | null): string {
  const hour = now.getHours();
  let greeting = "לילה טוב";
  if (hour >= 5 && hour < 12) greeting = "בוקר טוב";
  else if (hour >= 12 && hour < 17) greeting = "צהריים טובים";
  else if (hour >= 17 && hour < 22) greeting = "ערב טוב";
  return firstName ? `${greeting} ${firstName}` : greeting;
}

export function natalieScanMessage(state: NatalieScanPresentation): string {
  switch (state) {
    case "checking_email":
      return "אני עדיין בודקת את המיילים שלך.";
    case "unfinished":
      return "הסריקה הקודמת לא הסתיימה. אפשר לנסות שוב מתי שנוח לך.";
    case "finished":
      return "סיימתי לעבור על המיילים.";
    default:
      return "אני מוכנה לבדוק את המיילים כשתרצה.";
  }
}

export function natalieDuplicateMessage(ctx: NatalieCopyContext = {}): string {
  const supplier = ctx.supplierName?.trim();
  if (supplier) return `המסמך מ${supplier} כבר שמור אצלי.`;
  return "המסמך הזה כבר שמור אצלי.";
}

export function natalieReviewMessage(
  presentation: NatalieReviewPresentation,
  ctx: NatalieCopyContext = {}
): string {
  const supplier = ctx.supplierName?.trim() || "הספק";

  switch (presentation) {
    case "ambiguous_supplier":
      return "מצאתי שני ספקים אפשריים.\nאפשר שתעזור לי לבחור?";
    case "missing_details":
      return `חסרים לי פרטים במסמך מ${supplier}.\nתוכל לעזור לי להשלים?`;
    case "ready_to_approve":
      return `הכנתי את המסמך מ${supplier} לאישור שלך.`;
    case "already_handled":
      return "כבר טיפלתי במסמך הזה.";
    default:
      return ctx.uncertaintyReason?.trim()
        ? `לא הייתי בטוחה לגבי ${supplier}. ${sanitizeUncertainty(ctx.uncertaintyReason)}`
        : `יש מסמך מ${supplier} שצריך את ההחלטה שלך.`;
  }
}

export function nataliePaymentMessage(kind: "prepared" | "paid" | "missing_invoice", ctx: NatalieCopyContext = {}): string {
  const supplier = ctx.supplierName?.trim() || "הספק";
  switch (kind) {
    case "paid":
      return `סימנתי את התשלום ל${supplier} כשולם.`;
    case "missing_invoice":
      return `יש תשלום ל${supplier} בלי חשבונית. אשמח לעזרה לסגור את זה.`;
    default:
      return `הכנתי תשלום ל${supplier}.`;
  }
}

export function natalieAppointmentMessage(kind: "scheduled" | "needs_confirmation", ctx: NatalieCopyContext = {}): string {
  const client = ctx.clientName?.trim() || "הלקוח";
  if (kind === "needs_confirmation") return `יש פגישה עם ${client} שצריך לאשר.`;
  return `קבעתי עבורך פגישה עם ${client}.`;
}

export function natalieTaskMessage(title?: string | null): string {
  const trimmed = title?.trim();
  return trimmed ? `הוספתי משימה: ${trimmed}.` : "הוספתי משימה חדשה עבורך.";
}

export function inferReviewPresentation(input: {
  reviewStatus?: string | null;
  uncertaintyReason?: string | null;
}): NatalieReviewPresentation {
  const status = (input.reviewStatus ?? "").toLowerCase();
  const reason = (input.uncertaintyReason ?? "").toLowerCase();

  if (status === "approved" || status === "auto_saved") return "already_handled";
  if (reason.includes("supplier") && (reason.includes("ambiguous") || reason.includes("possible") || reason.includes("שני"))) {
    return "ambiguous_supplier";
  }
  if (reason.includes("missing") || reason.includes("חסר")) return "missing_details";
  if (status === "needs_review") return "needs_confirmation";
  return "ready_to_approve";
}

export function customerCopyContainsForbiddenTerms(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_CUSTOMER_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}

export function assertCustomerCopy(text: string): string {
  const forbidden = customerCopyContainsForbiddenTerms(text);
  if (forbidden) {
    throw new Error(`Customer copy must not expose "${forbidden}"`);
  }
  return text;
}

function sanitizeUncertainty(reason: string): string {
  const trimmed = reason.trim();
  if (customerCopyContainsForbiddenTerms(trimmed)) {
    return "אשמח שתעזור לי לוודא שהפרטים נכונים.";
  }
  if (/^[a-z0-9\s.,:_-]+$/i.test(trimmed) && !/[\u0590-\u05FF]/.test(trimmed)) {
    return "אשמח שתעזור לי לוודא שהפרטים נכונים.";
  }
  return trimmed;
}
