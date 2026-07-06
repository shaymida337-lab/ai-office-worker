export type DocumentReviewItem = {
  id: string;
  source: string;
  sender: string | null;
  subject: string | null;
  fileName: string | null;
  documentType: string;
  supplierName: string | null;
  supplierDisplayName?: string | null;
  rawSupplierName?: string | null;
  supplierConfidence?: "high" | "low" | "missing";
  supplierNeedsConfirmation?: boolean;
  supplierUncertain?: boolean;
  confirmedSupplierName?: string | null;
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
  documentDate?: string | null;
  invoiceNumber?: string | null;
};

export type ReviewMissingFieldId =
  | "supplier"
  | "amount"
  | "document_date"
  | "document_type"
  | "document_file"
  | "invoice_number";

export type ReviewMissingField = {
  id: ReviewMissingFieldId;
  labelHebrew: string;
  blocking: boolean;
};

export type ReviewPrimaryActionKind =
  | "complete_details"
  | "ready_to_approve"
  | "needs_special_review"
  | "edit_supplier";

export type ReviewPrimaryAction = {
  kind: ReviewPrimaryActionKind;
  statusLabel: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  rejectLabel: string;
  canApprove: boolean;
  canEditSupplier: boolean;
  missingFields: ReviewMissingField[];
  advisoryFields: ReviewMissingField[];
};

const PLACEHOLDER_SUPPLIER_NAMES = new Set(["לא זוהה", "ספק לא ידוע", "unknown", ""]);

const PAYMENT_DOCUMENT_TYPES = new Set([
  "tax_invoice",
  "invoice",
  "receipt",
  "tax_invoice_receipt",
  "payment_request",
]);

export function reviewSupplierDisplayName(item: DocumentReviewItem): string {
  return (
    item.confirmedSupplierName?.trim() ||
    item.supplierDisplayName?.trim() ||
    item.supplierName?.trim() ||
    ""
  );
}

function normalizedSupplierName(item: DocumentReviewItem): string {
  return reviewSupplierDisplayName(item);
}

function supplierNeedsUserConfirmation(item: DocumentReviewItem): boolean {
  if (item.confirmedSupplierName?.trim()) return false;
  return Boolean(
    item.supplierNeedsConfirmation ||
      item.supplierUncertain ||
      item.supplierConfidence === "low"
  );
}

function hasVerifiedSupplier(item: DocumentReviewItem): boolean {
  const name = normalizedSupplierName(item);
  if (!name || PLACEHOLDER_SUPPLIER_NAMES.has(name)) return false;
  return true;
}

function hasVerifiedAmount(item: DocumentReviewItem): boolean {
  if (item.amountLabel === "סכום חסר") return false;
  const amount = item.displayAmount ?? item.totalAmount;
  if (amount != null && Number.isFinite(amount) && amount > 0) return true;
  if (item.amountLabel) {
    const match = item.amountLabel.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    if (match && Number(match[1]) > 0) return true;
  }
  return false;
}

function normalizeReviewDocumentType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (/tax_invoice_receipt|invoice_receipt|חשבונית\s*מס\s*קבלה/.test(normalized)) return "tax_invoice_receipt";
  if (/payment_request|payment request|דרישת|בקשת/.test(normalized)) return "payment_request";
  if (/receipt|קבלה/.test(normalized)) return "receipt";
  if (/invoice|tax_invoice|חשבונית/.test(normalized)) return "tax_invoice";
  return normalized;
}

function hasVerifiedDocumentType(item: DocumentReviewItem): boolean {
  const type = normalizeReviewDocumentType(item.documentType ?? "");
  if (!type || type === "irrelevant" || type === "unknown") return false;
  return PAYMENT_DOCUMENT_TYPES.has(type);
}

function hasDocumentFile(item: DocumentReviewItem): boolean {
  if (item.driveFileUrl?.trim()) return true;
  if (item.fileName?.trim()) return true;
  return false;
}

function hasDocumentDateField(item: DocumentReviewItem): boolean {
  if (item.documentDate) {
    const parsed = new Date(item.documentDate);
    if (!Number.isNaN(parsed.getTime())) return true;
  }
  const reason = (item.uncertaintyReason ?? "").toLowerCase();
  return !reason.includes("invoice date missing") && !reason.includes("חסר תאריך");
}

function hasInvoiceNumberField(item: DocumentReviewItem): boolean {
  if (item.invoiceNumber?.trim()) return true;
  const reason = (item.uncertaintyReason ?? "").toLowerCase();
  return !reason.includes("invoice number missing") && !reason.includes("חסר מספר");
}

export function getReviewMissingFields(item: DocumentReviewItem): {
  blocking: ReviewMissingField[];
  advisory: ReviewMissingField[];
} {
  const blocking: ReviewMissingField[] = [];
  const advisory: ReviewMissingField[] = [];

  if (!hasVerifiedSupplier(item)) {
    blocking.push({ id: "supplier", labelHebrew: "חסר ספק", blocking: true });
  }
  if (!hasVerifiedAmount(item)) {
    blocking.push({ id: "amount", labelHebrew: "חסר סכום", blocking: true });
  }
  if (!hasVerifiedDocumentType(item)) {
    blocking.push({ id: "document_type", labelHebrew: "חסר סוג מסמך", blocking: true });
  }
  if (!hasDocumentFile(item)) {
    blocking.push({ id: "document_file", labelHebrew: "חסר קובץ מסמך", blocking: true });
  }
  if (!hasDocumentDateField(item)) {
    advisory.push({ id: "document_date", labelHebrew: "חסר תאריך", blocking: false });
  }
  if (!hasInvoiceNumberField(item)) {
    advisory.push({
      id: "invoice_number",
      labelHebrew: "מספר מסמך חסר — ניתן לאשר ידנית",
      blocking: false,
    });
  }
  if (supplierNeedsUserConfirmation(item) && hasVerifiedSupplier(item)) {
    advisory.push({ id: "supplier", labelHebrew: "ספק לא בטוח", blocking: false });
  }

  return { blocking, advisory };
}

function isAmbiguousSupplierReason(item: DocumentReviewItem): boolean {
  const reason = (item.uncertaintyReason ?? "").toLowerCase();
  return (
    reason.includes("supplier") &&
    (reason.includes("ambiguous") || reason.includes("possible") || reason.includes("שני"))
  );
}

export function getReviewPrimaryAction(item: DocumentReviewItem): ReviewPrimaryAction {
  const status = (item.reviewStatus ?? "").toLowerCase();
  const { blocking, advisory } = getReviewMissingFields(item);
  const rejectLabel = "דחה";

  if (status === "approved" || status === "auto_saved") {
    return {
      kind: "ready_to_approve",
      statusLabel: "אושר והועבר לחשבוניות",
      primaryLabel: "אושר והועבר לחשבוניות",
      secondaryLabel: null,
      rejectLabel,
      canApprove: false,
      canEditSupplier: false,
      missingFields: [],
      advisoryFields: [],
    };
  }

  if (isAmbiguousSupplierReason(item)) {
    return {
      kind: "needs_special_review",
      statusLabel: "דורש השלמה",
      primaryLabel: "השלם פרטים",
      secondaryLabel: item.driveFileUrl ? "פתח מסמך" : null,
      rejectLabel,
      canApprove: false,
      canEditSupplier: true,
      missingFields: [{ id: "supplier", labelHebrew: "חסר ספק", blocking: true }],
      advisoryFields: advisory,
    };
  }

  if (blocking.length > 0) {
    return {
      kind: "complete_details",
      statusLabel: "דורש השלמה",
      primaryLabel: "השלם פרטים",
      secondaryLabel: item.driveFileUrl ? "פתח מסמך" : null,
      rejectLabel,
      canApprove: false,
      canEditSupplier: blocking.some((field) => field.id === "supplier") || hasVerifiedSupplier(item),
      missingFields: blocking,
      advisoryFields: advisory,
    };
  }

  if (supplierNeedsUserConfirmation(item)) {
    return {
      kind: "edit_supplier",
      statusLabel: "ספק לא בטוח",
      primaryLabel: "ערוך ספק",
      secondaryLabel: item.driveFileUrl ? "פתח מסמך" : null,
      rejectLabel,
      canApprove: false,
      canEditSupplier: true,
      missingFields: [],
      advisoryFields: advisory,
    };
  }

  return {
    kind: "ready_to_approve",
    statusLabel: "מוכן לאישור",
    primaryLabel: "אשר והעבר לחשבוניות",
    secondaryLabel: "ערוך פרטים",
    rejectLabel,
    canApprove: true,
    canEditSupplier: true,
    missingFields: [],
    advisoryFields: advisory,
  };
}

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
  rawSupplierName: string | null;
  amountLabel: string;
  documentTypeLabel: string;
  reason: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  rejectLabel: string;
  canApprove: boolean;
  canEditSupplier: boolean;
  missingFields: ReviewMissingField[];
  advisoryFields: ReviewMissingField[];
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

/**
 * מיפוי קודי סיבה טכניים (uncertaintyReason / gates[].reasonCode) לעברית
 * ספציפית — במקום "חסרים פרטים" גנרי. סדר הבדיקות חשוב: הספציפי לפני הכללי.
 */
function mapReasonCodeToHebrew(raw: string): string | null {
  const reason = raw.trim();
  if (!reason) return null;
  const lower = reason.toLowerCase();

  if (lower.includes("invoice number missing")) return "חסר מספר חשבונית";
  if (lower.includes("invoice date missing")) return "חסר תאריך מסמך";

  if (lower.includes("duplicate") || reason.includes("כפיל")) return "יש חשד שהמסמך כבר קיים";

  if (lower.includes("supplier.sir_weak_evidence")) return "הספק זוהה, אבל הראיות לזיהוי חלשות";
  if (lower.includes("supplier.sir_ambiguous")) return "נמצאו כמה ספקים אפשריים במסמך";
  if (lower.includes("supplier.not_supplier") || lower.includes("supplier.sir_rejected")) {
    return "השולח לא זוהה כספק";
  }
  if (lower.startsWith("supplier.") || lower.includes("supplier.sir_missing")) {
    return "לא זוהה ספק בצורה מספיק בטוחה";
  }

  if (lower.includes("amount.vat_mismatch")) return "יש אי־התאמה בסכום או במע״מ";
  if (lower.includes("amount.arc_ambiguous") || lower.includes("amount.source_conflict")) {
    return "נמצאו כמה סכומים אפשריים במסמך";
  }
  if (lower.includes("amount.threshold_exceeded")) return "הסכום גבוה באופן חריג";
  if (lower.includes("amount.decimal_shift") || lower.includes("amount.weird_decimals")) {
    return "הסכום שזוהה נראה שגוי";
  }
  if (lower.startsWith("amount.")) return "לא זוהה סכום לתשלום";

  if (lower.startsWith("fingerprint.")) return "חסרים פרטים מזהים במסמך (מספר חשבונית או תאריך)";

  if (lower.startsWith("trust.")) return null;
  if (lower.includes("confidence below")) return "רמת הביטחון בזיהוי המסמך נמוכה מדי";
  if (lower.startsWith("classifier:")) return "הסיווג האוטומטי ביקש בדיקה נוספת";

  // טקסט עברי חופשי (למשל מוואטסאפ) — מוצג כמו שהוא
  if (/[֐-׿]/.test(reason)) return reason;

  return null;
}

function firstGateReviewReasonCode(parsedFieldsJson: unknown): string | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object") return null;
  const gates = (parsedFieldsJson as { gates?: unknown }).gates;
  if (!Array.isArray(gates)) return null;
  for (const entry of gates) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.verdict !== "review" && record.verdict !== "block") continue;
    if (typeof record.reasonCode === "string") return record.reasonCode;
  }
  return null;
}

/**
 * הסיבה הספציפית בעברית שבגללה המסמך מחכה לבדיקה, או null כשאין מיפוי.
 * מסמך שכבר אושר לא מציג סיבה ישנה כבעיה פעילה.
 */
export function specificReviewReasonHebrew(
  item: Pick<DocumentReviewItem, "uncertaintyReason" | "reviewStatus" | "parsedFieldsJson">
): string | null {
  const status = (item.reviewStatus ?? "").toLowerCase();
  if (status === "approved" || status === "auto_saved") return null;
  const fromReason = item.uncertaintyReason ? mapReasonCodeToHebrew(item.uncertaintyReason) : null;
  if (fromReason) return fromReason;
  const gateCode = firstGateReviewReasonCode(item.parsedFieldsJson);
  return gateCode ? mapReasonCodeToHebrew(gateCode) : null;
}

/**
 * הודעת כשל אישור ידידותית: מתרגמת את הודעות ה-422 של השרת (כולל קוד הסיבה
 * שבסוגריים) לעברית ספציפית, במקום "אישור המסמך נכשל" גנרי.
 */
export function approvalErrorHebrew(message: string): string {
  if (message.includes("verified total amount")) return "אי אפשר לאשר כי הסכום לא זוהה בצורה בטוחה";
  if (message.includes("verified supplier name")) return "אי אפשר לאשר כי הספק לא זוהה";
  if (message.includes("supplier.needs_confirmation")) {
    return "יש לאשר או לערוך את שם הספק לפני האישור";
  }
  if (message.includes("verified document fingerprint")) return "אי אפשר לאשר כי חסרים פרטים מזהים במסמך";
  const codeMatch = message.match(/\(([^)]+)\)\s*$/);
  const mapped = codeMatch ? mapReasonCodeToHebrew(codeMatch[1]) : null;
  if (mapped) return `אי אפשר לאשר את המסמך — ${mapped}`;
  return message.trim() || "אישור המסמך נכשל";
}

export function presentDocument(item: DocumentReviewItem): DocumentPresentation {
  const action = getReviewPrimaryAction(item);
  const supplier = normalizedSupplierName(item) || "ספק לא ידוע";
  const isDuplicate = isDuplicateReason(item.uncertaintyReason);

  let reason = "";
  if (action.missingFields.length > 0) {
    reason = action.missingFields.map((field) => field.labelHebrew).join(" · ");
  } else if (isDuplicate) {
    const specific = specificReviewReasonHebrew(item);
    reason =
      specific ??
      "יש חשד שהמסמך כבר קיים — אפשר לאשר אם זה מסמך חדש, או לדחות אם זו כפילות.";
  } else if (action.kind === "edit_supplier") {
    reason = "ספק לא בטוח — אשר את השם או ערוך לפני האישור.";
    if (item.rawSupplierName && item.rawSupplierName !== supplier) {
      reason += ` (זוהה במקור: ${item.rawSupplierName})`;
    }
  } else if (action.kind === "ready_to_approve" && action.canApprove) {
    reason = "המסמך מוכן לאישור";
    if (action.advisoryFields.length > 0) {
      reason += ` (${action.advisoryFields.map((field) => field.labelHebrew).join(" · ")})`;
    }
  } else if (action.kind === "ready_to_approve") {
    reason = "כבר טיפלתי במסמך הזה.";
  } else {
    const specific = specificReviewReasonHebrew(item);
    reason =
      specific ??
      (action.missingFields.length > 0
        ? action.missingFields.map((field) => field.labelHebrew).join(" · ")
        : "אשמח שתעזור לי לוודא שהפרטים נכונים.");
    if (action.advisoryFields.length > 0) {
      reason += ` (${action.advisoryFields.map((field) => field.labelHebrew).join(" · ")})`;
    }
  }

  return {
    typeLabel: action.statusLabel,
    supplier,
    rawSupplierName: item.rawSupplierName?.trim() || item.supplierName?.trim() || null,
    amountLabel: documentReviewAmountLabel(item),
    documentTypeLabel: documentTypeLabel(item.documentType),
    reason,
    primaryLabel: action.primaryLabel,
    secondaryLabel: action.secondaryLabel,
    rejectLabel: action.rejectLabel,
    canApprove: action.canApprove,
    canEditSupplier: action.canEditSupplier,
    missingFields: action.missingFields,
    advisoryFields: action.advisoryFields,
    isBlocked:
      action.kind === "complete_details" ||
      action.kind === "needs_special_review" ||
      action.kind === "edit_supplier",
    isDuplicate,
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
