import { inferReviewPresentation, natalieScanMessage } from "./copy";
import type {
  NatalieBriefingInput,
  NatalieBriefingItem,
  NatalieRecommendation,
  NatalieRecommendationInput,
} from "./types";

function supplierLabel(name?: string | null) {
  return name?.trim() || "הספק";
}

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

function countUrgentPayments(payments: NatalieRecommendationInput["unpaidPayments"], now: Date) {
  return (payments ?? []).filter((p) => !p.paid && paymentDueLabel(p.date, now)).length;
}

export function buildProactiveDoneItems(input: NatalieBriefingInput, now = input.now ?? new Date()): NatalieBriefingItem[] {
  const items: NatalieBriefingItem[] = [];
  const reviewCount = input.documentReviews?.length ?? 0;
  const urgentPayments = countUrgentPayments(input.unpaidPayments, now);

  if (input.gmailConnected) {
    items.push({
      id: "emails",
      text: input.scanRunning
        ? "אני עדיין בודקת את המיילים שלך"
        : input.scanStale
          ? natalieScanMessage("unfinished")
          : input.scanBacklog
            ? natalieScanMessage("backlog")
            : "סיימתי לעבור על המיילים שלך",
    });
  }

  if ((input.invoicesSaved ?? 0) > 0) {
    const count = input.invoicesSaved ?? 0;
    const base = count === 1 ? "שמרתי חשבונית אחת" : `שמרתי ${count} חשבוניות`;
    const follow =
      reviewCount > 1
        ? "אני ממליצה שנתחיל בשתיים שהכי דחופות"
        : reviewCount === 1
          ? "אני ממליצה שנתחיל במסמך שמחכה לאישור שלך"
          : "";
    items.push({ id: "invoices", text: follow ? `${base}. ${follow}.` : `${base}.` });
  }

  if ((input.paymentsPrepared ?? 0) > 0) {
    const count = input.paymentsPrepared ?? 0;
    const base = count === 1 ? "הכנתי תשלום אחד" : `הכנתי ${count} תשלומים`;
    const follow =
      urgentPayments > 1
        ? "שניים מהם צריכים לצאת עוד היום"
        : urgentPayments === 1
          ? "אחד מהם צריך לצאת עוד היום"
          : "";
    items.push({ id: "payments", text: follow ? `${base}. ${follow}.` : `${base}.` });
  }

  if (reviewCount > 0 && (input.invoicesSaved ?? 0) === 0) {
    const base = reviewCount === 1 ? "מצאתי מסמך אחד" : `מצאתי ${reviewCount} מסמכים`;
    const blocked = (input.documentReviews ?? []).some(
      (r) => inferReviewPresentation(r) === "ambiguous_supplier" || inferReviewPresentation(r) === "missing_details"
    );
    const follow = blocked
      ? "אחד מהם מונע ממני לסיים את העבודה"
      : "אני ממליצה שנאשר אותם לפני שממשיכים";
    items.push({ id: "reviews-found", text: `${base}. ${follow}.` });
  }

  if ((input.upcomingAppointments?.length ?? 0) > 0) {
    items.push({ id: "meetings", text: "סידרתי את הפגישות שלך להמשך השבוע." });
  }

  if (items.length === 0 && !input.scanRunning) {
    items.push({ id: "ready", text: "אני מוכנה לעבוד עבורך." });
  }

  return items.slice(0, 3);
}

export function buildCalmBriefingClose(input: NatalieRecommendationInput): string {
  const pending = input.pendingDecisionCount ?? 0;
  if (pending === 0) {
    const prefix =
      (input.invoicesSaved ?? 0) > 0 || (input.paymentsPrepared ?? 0) > 0 ? "סיימתי כבר את רוב העבודה. " : "";
    return `${prefix}סיימתי את כל מה שהיה לי לעשות. כרגע אין שום דבר דחוף. אני כאן אם תצטרך אותי.`;
  }
  if (pending === 1) {
    return "נשאר לנו רק דבר אחד קטן — ואז הכול שקט.";
  }
  if (pending === 2) {
    return "אני צריכה ממך רק שתי החלטות. אם נסיים אותן עכשיו, אחר כך הכול יהיה שקט.";
  }
  return `אני צריכה ממך ${pending} החלטות. אני ממליצה שנתחיל מהדחוף ביותר.`;
}

export function resolveNatalieRecommendation(input: NatalieRecommendationInput): NatalieRecommendation {
  const now = input.now ?? new Date();
  const reviews = input.documentReviews ?? [];
  const unpaid = (input.unpaidPayments ?? []).filter((p) => !p.paid);
  const missing = input.missingInvoices ?? [];
  const pendingAppts = (input.upcomingAppointments ?? []).filter((a) => {
    const legacyPending = (a.status ?? "").toLowerCase() === "pending";
    const enginePending = a.pendingOwnerApproval === true;
    return legacyPending || enginePending;
  });
  const schedulingDecisions = input.pendingSchedulingDecisions ?? [];

  if (schedulingDecisions.length > 0) {
    const decision = schedulingDecisions[0];
    return {
      kind: "appointment",
      title: `${decision.typeLabel}: ${decision.title}`,
      reason: "הבקשה ממתינה לאישורך לפני שתיקבע ביומן.",
      ctaLabel: "טפלי בזה עכשיו",
      href: decision.href,
      scrollToDecisions: true,
    };
  }

  if (!input.gmailConnected) {
    return {
      kind: "connect_gmail",
      title: "נתחיל מחיבור ג׳ימייל",
      reason: "ברגע שנחבר, אוכל לסרוק ולסדר את המסמכים בשבילך.",
      ctaLabel: "חברי את הג׳ימייל",
      scrollToDecisions: false,
    };
  }

  for (const review of reviews) {
    const presentation = inferReviewPresentation(review);
    if (presentation === "ambiguous_supplier" || presentation === "missing_details") {
      const supplier = supplierLabel(review.supplierName);
      return {
        kind: "blocked_review",
        title: presentation === "ambiguous_supplier" ? `נבחר הספק הנכון — ${supplier}` : `להשלים פרטים במסמך של ${supplier}`,
        reason:
          presentation === "ambiguous_supplier"
            ? "בלי ההחלטה הזו אני לא יכולה לסיים את שאר העבודה."
            : "חסרים פרטים קטנים, ואחרי זה אוכל לסגור את המסמך.",
        ctaLabel: "טפלי בזה עכשיו",
        href: "/dashboard/document-reviews",
        scrollToDecisions: true,
      };
    }
  }

  const urgent = unpaid.find((p) => paymentDueLabel(p.date, now) === "today" || paymentDueLabel(p.date, now) === "tomorrow");
  if (urgent) {
    const supplier = supplierLabel(urgent.supplier);
    const due = paymentDueLabel(urgent.date, now);
    return {
      kind: "urgent_payment",
      title: `לאשר תשלום ל${supplier}`,
      reason: due === "today" ? "התשלום הזה אמור לצאת היום." : "התשלום הזה אמור לצאת מחר.",
      ctaLabel: "טפלי בזה עכשיו",
      href: "/payments",
      scrollToDecisions: true,
    };
  }

  if (reviews.length > 0) {
    const review = reviews[0];
    const supplier = supplierLabel(review.supplierName);
    return {
      kind: "document_review",
      title: `לאשר מסמך של ${supplier}`,
      reason: reviews.length > 1 ? "זה המסמך שהכי כדאי לסגור קודם." : "אחרי האישור הזה אוכל להמשיך לשאר העבודה.",
      ctaLabel: "טפלי בזה עכשיו",
      href: "/dashboard/document-reviews",
      scrollToDecisions: true,
    };
  }

  if (missing.length > 0) {
    const item = missing[0];
    const supplier = supplierLabel(item.supplier);
    return {
      kind: "missing_invoice",
      title: `לצרף חשבונית ל${supplier}`,
      reason: "בלי החשבונית אני לא יכולה לסגור את התשלום הזה.",
      ctaLabel: "טפלי בזה עכשיו",
      scrollToDecisions: true,
    };
  }

  const soonAppt = pendingAppts.find((a) => {
    const start = new Date(a.startTime);
    return !Number.isNaN(start.getTime()) && start.getTime() - now.getTime() < 48 * 60 * 60 * 1000;
  });
  if (soonAppt) {
    const client = soonAppt.clientName?.trim() || "לקוח";
    return {
      kind: "appointment",
      title: `לאשר פגישה עם ${client}`,
      reason: "הפגישה מתקרבת וכדאי לוודא שהיא עדיין מתאימה.",
      ctaLabel: "טפלי בזה עכשיו",
      href: "/dashboard/calendar",
      scrollToDecisions: true,
    };
  }

  if ((input.openTasksCount ?? 0) > 0) {
    return {
      kind: "open_tasks",
      title: "לסגור משימה אחת שפתוחה",
      reason: "זה ייקח פחות מדקה וישאיר לך יום נקי יותר.",
      ctaLabel: "טפלי בזה עכשיו",
      href: "/tasks",
    };
  }

  const emotionalNote =
    (input.invoicesSaved ?? 0) > 0 || (input.paymentsPrepared ?? 0) > 0
      ? "סיימתי כבר את רוב העבודה."
      : undefined;

  return {
    kind: "all_clear",
    title: "אין כרגע דבר דחוף",
    reason: "סיימתי את כל מה שהיה לי לעשות. אני כאן אם תצטרך אותי.",
    ctaLabel: "מה עשיתי היום?",
    emotionalNote,
  };
}
