import { inferReviewPresentation, natalieReviewMessage } from "@/lib/natalie/copy";

export type DocumentReviewItem = {
  id: string;
  source: string;
  sender: string | null;
  subject: string | null;
  fileName: string | null;
  documentType: string;
  supplierName: string | null;
  totalAmount: number | null;
  displayAmount?: number | null;
  amountLabel?: string;
  amountResolved?: boolean;
  currency?: string | null;
  confidenceScore: number;
  uncertaintyReason: string | null;
  driveFileUrl: string | null;
  reviewStatus: string;
  createdAt: string;
  parsedFieldsJson?: unknown;
};

export function documentReviewAmountLabel(item: DocumentReviewItem): string {
  if (item.amountLabel) return item.amountLabel;
  return formatDocumentAmount(item.displayAmount ?? item.totalAmount, item.currency ?? "ILS", item.parsedFieldsJson);
}

export type DocumentFilter =
  | "all"
  | "needs_decision"
  | "completed"
  | "blocked"
  | "duplicates"
  | "this_month";

export type DocumentPresentation = {
  typeLabel: string;
  supplier: string;
  amountLabel: string;
  documentTypeLabel: string;
  reason: string;
  primaryLabel: string;
  secondaryLabel: string;
  isBlocked: boolean;
  isDuplicate: boolean;
};

export function sourceLabel(source: string) {
  return source === "whatsapp" ? "וואטסאפ" : source === "gmail" ? "ג׳ימייל" : source.replace(/_/g, " ");
}

export function documentTypeLabel(type: string) {
  const labels: Record<string, string> = {
    tax_invoice: "חשבונית מס",
    invoice: "חשבונית מס",
    receipt: "קבלה",
    tax_invoice_receipt: "חשבונית מס קבלה",
    payment_request: "דרישת תשלום",
    quote: "הצעת מחיר",
    irrelevant: "מסמך לא רלוונטי",
  };
  return labels[type] ?? "מסמך";
}

export function formatDocumentAmount(amount: number | null, currency = "ILS", parsedFieldsJson?: unknown) {
  const gate = parseAmountGateLabel(parsedFieldsJson);
  if (gate) return gate;
  if (amount == null) return "סכום חסר";
  const formatted = amount.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (currency === "ILS") return `₪${formatted}`;
  return `${formatted} ${currency}`;
}

const AMOUNT_GATE_MISSING_REASONS = new Set([
  "amount.unresolved",
  "amount.zero",
  "amount.arc_missing",
  "amount.invalid",
  "amount.negative",
]);

function parseAmountGateLabel(parsedFieldsJson: unknown): string | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || parsedFieldsJson === null) {
    return null;
  }
  const gates = (parsedFieldsJson as { gates?: unknown }).gates;
  if (!Array.isArray(gates)) return null;
  for (const entry of gates) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.gate !== "amount" || record.verdict !== "review") continue;
    const reasonCode = typeof record.reasonCode === "string" ? record.reasonCode : "amount.unresolved";
    return AMOUNT_GATE_MISSING_REASONS.has(reasonCode) ? "סכום חסר" : "דורש בדיקה";
  }
  return null;
}

export function formatDocumentDate(value: string) {
  return new Date(value).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

export function drivePreviewUrl(url: string | null, apiBase?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/file/d/${match[1]}/preview`;
  if (url.startsWith("/uploads/")) {
    const base = (apiBase ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
    return `${base}${url}`;
  }
  return url;
}

function isDuplicateReason(reason: string | null | undefined) {
  return (reason ?? "").toLowerCase().includes("duplicate") || (reason ?? "").includes("כפיל");
}

function isInvoiceReceiptUncertain(item: DocumentReviewItem) {
  const reason = (item.uncertaintyReason ?? "").toLowerCase();
  const type = item.documentType.toLowerCase();
  return (
    reason.includes("receipt") ||
    reason.includes("invoice") ||
    reason.includes("קבלה") ||
    reason.includes("חשבונית") ||
    (type.includes("receipt") && type.includes("invoice"))
  );
}

export function presentDocument(item: DocumentReviewItem): DocumentPresentation {
  const presentation = inferReviewPresentation(item);
  const supplier = item.supplierName?.trim() || item.sender?.trim() || "ספק לא ידוע";
  const reasonRaw = natalieReviewMessage(presentation, {
    supplierName: item.supplierName,
    uncertaintyReason: item.uncertaintyReason,
  }).replace(/\n/g, " ");

  let reason = reasonRaw;
  let primaryLabel = "אשרי";
  let secondaryLabel = "פתחי מסמך";
  let typeLabel = "מסמך לאישור";

  if (presentation === "ambiguous_supplier") {
    typeLabel = "ספק לא ברור";
    reason = "מצאתי שני ספקים אפשריים. אפשר שתעזור לי לבחור?";
    primaryLabel = "בחר ספק";
    secondaryLabel = "פתח מסמך";
  } else if (presentation === "missing_details") {
    typeLabel = "חסרים פרטים";
    reason = `חסרים לי פרטים במסמך מ${supplier}. תוכל לעזור לי להשלים?`;
    primaryLabel = "השלימי פרטים";
    secondaryLabel = "פתחי מסמך";
  } else if (isInvoiceReceiptUncertain(item) && presentation === "needs_confirmation") {
    typeLabel = "סוג מסמך";
    reason = "אני לא בטוחה אם זו חשבונית או קבלה.";
    primaryLabel = "בדוק";
    secondaryLabel = "פתחי מסמך";
  } else if (isDuplicateReason(item.uncertaintyReason)) {
    typeLabel = "חשד לכפילות";
    reason = "נראה שמסמך דומה כבר קיים. תעזור לי להחליט?";
    primaryLabel = "בדוק";
    secondaryLabel = "פתחי מסמך";
  } else if (presentation === "ready_to_approve") {
    reason = `הכנתי את המסמך מ${supplier} לאישור שלך.`;
    primaryLabel = "אשרי";
    secondaryLabel = "פתחי מסמך";
  }

  return {
    typeLabel,
    supplier,
    amountLabel: documentReviewAmountLabel(item),
    documentTypeLabel: documentTypeLabel(item.documentType),
    reason,
    primaryLabel,
    secondaryLabel,
    isBlocked: presentation === "ambiguous_supplier" || presentation === "missing_details",
    isDuplicate: isDuplicateReason(item.uncertaintyReason),
  };
}

export function isCompletedDocument(item: DocumentReviewItem) {
  const status = (item.reviewStatus ?? "").toLowerCase();
  return status === "approved" || status === "auto_saved";
}

export function isThisMonth(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function isToday(value: string) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function matchesDocumentSearch(item: DocumentReviewItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    item.supplierName,
    item.sender,
    item.subject,
    item.fileName,
    documentTypeLabel(item.documentType),
    item.displayAmount != null ? String(item.displayAmount) : item.totalAmount != null ? String(item.totalAmount) : "",
    item.amountLabel ?? "",
    formatDocumentDate(item.createdAt),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (haystack.includes(q)) return true;

  if (q.includes("אתמול")) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const itemDate = new Date(item.createdAt);
    return itemDate.toDateString() === yesterday.toDateString();
  }

  if (q.includes("החודש") || q.includes("חודש")) {
    return isThisMonth(item.createdAt);
  }

  const amountMatch = q.match(/(\d+)/);
  const searchableAmount = item.displayAmount ?? item.totalAmount;
  if (amountMatch && searchableAmount != null) {
    return searchableAmount >= Number(amountMatch[1]);
  }

  return false;
}

export function filterDocuments(
  pending: DocumentReviewItem[],
  completed: DocumentReviewItem[],
  filter: DocumentFilter,
  search: string
) {
  const searchPending = pending.filter((item) => matchesDocumentSearch(item, search));
  const searchCompleted = completed.filter((item) => matchesDocumentSearch(item, search));

  switch (filter) {
    case "completed":
      return { queue: [], completed: searchCompleted, showQueue: false };
    case "blocked":
      return {
        queue: searchPending.filter((item) => presentDocument(item).isBlocked),
        completed: searchCompleted,
        showQueue: true,
      };
    case "duplicates":
      return {
        queue: searchPending.filter((item) => presentDocument(item).isDuplicate),
        completed: searchCompleted,
        showQueue: true,
      };
    case "this_month":
      return {
        queue: searchPending.filter((item) => isThisMonth(item.createdAt)),
        completed: searchCompleted.filter((item) => isThisMonth(item.createdAt)),
        showQueue: true,
      };
    case "needs_decision":
    case "all":
    default:
      return { queue: searchPending, completed: searchCompleted, showQueue: true };
  }
}

export function remainingDocumentsMessage(count: number) {
  if (count === 0) return "סיימנו — אין עוד מסמכים שמחכים להחלטה שלך.";
  if (count === 1) return "נשאר עוד מסמך אחד.";
  if (count === 2) return "נשארו עוד שני מסמכים.";
  return `נשארו עוד ${count} מסמכים.`;
}

export function formatReviewQueueHeadline(visibleCount: number, totalCount: number): string {
  if (totalCount <= 0) return "";
  if (totalCount === 1) return "מסמך אחד מחכה להחלטה שלך";
  if (totalCount <= visibleCount) return `${totalCount} מסמכים מחכים להחלטה שלך`;
  return `מציג ${visibleCount} מתוך ${totalCount} מסמכים שמחכים להחלטה שלך`;
}
