import type { Invoice } from "@/components/invoices";
import { approvalErrorHebrew, readinessBlockReasonHebrew } from "@/lib/documents/presentation";

export type CompletionFieldKey = "supplier" | "amount" | "date" | "currency" | "documentType";

export type InvoiceCompletionActionKind =
  | "approve_only"
  | "complete_details"
  | "edit_supplier"
  | "blocked"
  | "not_invoice"
  | "none";

export type InvoiceCompletionAction = {
  kind: InvoiceCompletionActionKind;
  primaryLabel: string;
  canApproveWithoutEdit: boolean;
  hint?: string;
  focusField?: CompletionFieldKey;
};

export type InvoiceCompletionResponse = {
  dataComplete: boolean;
  approved: boolean;
  destination: "invoices" | "completion";
  invoice: Invoice;
  code?: string;
  error?: string;
};

const MISSING_FIELD_MARKERS = ["חסר סכום", "ספק לא זוהה", "חסר תאריך", "מטבע חסר", "סוג מסמך חסר"];
const PAYMENT_DOCUMENT_TYPES = new Set([
  "invoice",
  "receipt",
  "tax_invoice",
  "tax_invoice_receipt",
  "payment_request",
]);

const FIELD_LABELS: Record<CompletionFieldKey, string> = {
  amount: "הזן סכום",
  supplier: "בחר ספק",
  date: "בחר תאריך",
  documentType: "בחר סוג מסמך",
  currency: "בחר מטבע",
};

export function resolveInvoiceCompletionSourceType(invoice: Invoice): string | null {
  if (invoice.id.startsWith("gmail-scan:") || invoice.source === "gmail_scan_item") return "gmail-scan-item";
  if (invoice.id.startsWith("document-review:") || invoice.source === "financial_document_review") return "document-review";
  if (invoice.id.startsWith("supplier-payment:") || invoice.source === "supplier_payment") return "supplier-payment";
  return null;
}

export function resolveInvoiceCompletionId(invoice: Invoice): string {
  return invoice.id
    .replace(/^gmail-scan:/, "")
    .replace(/^document-review:/, "")
    .replace(/^supplier-payment:/, "");
}

export function getDocumentPreviewUrl(invoice: Invoice): string | null {
  return invoice.driveFileUrl ?? invoice.driveUrl ?? invoice.gmailMessageLink ?? null;
}

export function isNonFinancialCompletionItem(invoice: Invoice): boolean {
  if (invoice.approvalBlockReason === "מסמך לא רלוונטי") return true;
  const documentType = invoice.documentType?.trim().toLowerCase();
  if (documentType && !PAYMENT_DOCUMENT_TYPES.has(documentType)) return true;
  if (invoice.decisionReason?.includes("blocklisted_not_supplier_or_customer")) return true;
  return false;
}

export function inferInvoiceCompletionFlags(invoice: Invoice): { dataComplete: boolean; approvalRequired: boolean } {
  if (typeof invoice.dataComplete === "boolean" && typeof invoice.approvalRequired === "boolean") {
    return { dataComplete: invoice.dataComplete, approvalRequired: invoice.approvalRequired };
  }

  const missing =
    invoice.missingDataReasons ??
    (invoice.completionReasons ?? []).filter((reason) => MISSING_FIELD_MARKERS.some((marker) => reason.includes(marker)));
  const approval =
    invoice.approvalReasons ??
    (invoice.completionReasons ?? []).filter(
      (reason) => reason.includes("ממתין לאישור") || reason.includes("רמת ביטחון") || reason.includes("כמה סכומים"),
    );

  return {
    dataComplete: missing.length === 0,
    approvalRequired: approval.length > 0 || invoice.reviewStatus === "needs_review",
  };
}

export function missingFieldKeys(invoice: Invoice): Set<CompletionFieldKey> {
  const keys = new Set<CompletionFieldKey>();
  const reasons = invoice.missingDataReasons ?? [];
  if (reasons.length > 0) {
    for (const reason of reasons) {
      if (reason.includes("ספק")) keys.add("supplier");
      if (reason.includes("סכום")) keys.add("amount");
      if (reason.includes("תאריך")) keys.add("date");
      if (reason.includes("מטבע")) keys.add("currency");
      if (reason.includes("סוג מסמך")) keys.add("documentType");
    }
    return keys;
  }
  if (!invoice.supplierName?.trim()) keys.add("supplier");
  if (invoice.amount == null || !Number.isFinite(invoice.amount)) keys.add("amount");
  if (!invoice.date?.trim()) keys.add("date");
  if (!invoice.documentType?.trim()) keys.add("documentType");
  if (!invoice.currency?.trim()) keys.add("currency");
  return keys;
}

function resolveMissingFieldAction(invoice: Invoice): InvoiceCompletionAction {
  const missing = missingFieldKeys(invoice);
  if (missing.size >= 2) {
    return { kind: "complete_details", primaryLabel: "ערוך פרטים", canApproveWithoutEdit: false };
  }
  if (missing.size === 1) {
    const field = [...missing][0];
    return {
      kind: "complete_details",
      primaryLabel: FIELD_LABELS[field],
      canApproveWithoutEdit: false,
      focusField: field,
    };
  }
  return { kind: "complete_details", primaryLabel: "ערוך פרטים", canApproveWithoutEdit: false };
}

export function getInvoiceStatusChips(invoice: Invoice): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();
  const add = (chip: string) => {
    if (!seen.has(chip)) {
      seen.add(chip);
      chips.push(chip);
    }
  };

  for (const reason of invoice.missingDataReasons ?? []) {
    if (reason.includes("סכום")) add("חסר סכום");
    else if (reason.includes("ספק")) add("חסר ספק");
    else if (reason.includes("תאריך")) add("חסר תאריך");
    else if (reason.includes("מטבע")) add("חסר מטבע");
    else if (reason.includes("סוג מסמך")) add("חסר סוג מסמך");
  }

  const awaitingApproval = (invoice.approvalReasons ?? []).some(
    (reason) => reason.includes("ממתין לאישור") || reason.includes("רמת ביטחון"),
  );
  if (awaitingApproval || (invoice.approvalRequired && invoice.dataComplete && !invoice.canApproveDirectly)) {
    add("ממתין לאישור");
  }
  if (invoice.approvalBlockReason === "blocked_outcome") add("חסום");
  return chips;
}

export function getInvoiceCompletionAction(invoice: Invoice): InvoiceCompletionAction {
  if (invoice.source === "invoice" || !resolveInvoiceCompletionSourceType(invoice)) {
    return { kind: "none", primaryLabel: "", canApproveWithoutEdit: false };
  }

  const { dataComplete, approvalRequired } = inferInvoiceCompletionFlags(invoice);
  const blockHint = invoice.approvalBlockReason
    ? readinessBlockReasonHebrew({ blockReason: invoice.approvalBlockReason })
    : undefined;

  if (isNonFinancialCompletionItem(invoice)) {
    return {
      kind: "not_invoice",
      primaryLabel: "לא חשבונית",
      canApproveWithoutEdit: false,
      hint: "ניתן להסיר את המסמך מתור ההשלמה",
    };
  }

  if (invoice.approvalBlockReason === "blocked_outcome" || blockHint?.includes("חסום")) {
    return {
      kind: "blocked",
      primaryLabel: "בדוק מסמך",
      canApproveWithoutEdit: false,
      hint: blockHint ?? "המסמך חסום ולא ניתן לאשר אותו מכאן",
    };
  }

  if (invoice.supplierNeedsConfirmation || invoice.approvalBlockReason === "supplier.needs_confirmation") {
    return {
      kind: "edit_supplier",
      primaryLabel: "אשר ספק",
      canApproveWithoutEdit: false,
      focusField: "supplier",
      hint: "יש לאשר או לערוך את שם הספק לפני האישור",
    };
  }

  if (dataComplete && approvalRequired && invoice.canApproveDirectly === true) {
    return { kind: "approve_only", primaryLabel: "אשר", canApproveWithoutEdit: true };
  }

  if (!dataComplete) {
    return resolveMissingFieldAction(invoice);
  }

  if (approvalRequired) {
    return {
      kind: "complete_details",
      primaryLabel: "ערוך פרטים",
      canApproveWithoutEdit: false,
      hint: blockHint ?? "יש להשלים פרטים לפני אישור",
    };
  }

  return { kind: "none", primaryLabel: "", canApproveWithoutEdit: false };
}

export function completionSuccessMessage(kind: InvoiceCompletionActionKind): string {
  if (kind === "approve_only") return "החשבונית אושרה והועברה למסך חשבוניות";
  if (kind === "not_invoice") return "המסמך הוסר מתור ההשלמה";
  return "החשבונית הושלמה ועברה למסך חשבוניות";
}

export function completionErrorMessage(message: string): string {
  if (message.includes("לא ניתן לאשר")) return message;
  if (message.includes("not found")) return "המסמך לא נמצא";
  if (message.includes("חסום") || message.includes("BLOCKED")) return message;
  if (message.includes("GSI_APPROVE_REQUIRES_REVIEW")) return "לא ניתן לאשר — נדרש קישור למסמך ביקורת";
  return approvalErrorHebrew(message) || "האישור נכשל. נסה שוב.";
}

export function shouldOpenEditAfterCompletionError(message: string): boolean {
  return message.includes("supplier.needs_confirmation") || message.includes("שם הספק");
}

export const COMPLETION_DOCUMENT_TYPES = [
  { value: "invoice", label: "חשבונית" },
  { value: "receipt", label: "קבלה" },
  { value: "tax_invoice", label: "חשבונית מס" },
  { value: "tax_invoice_receipt", label: "חשבונית מס קבלה" },
  { value: "payment_request", label: "דרישת תשלום" },
] as const;
