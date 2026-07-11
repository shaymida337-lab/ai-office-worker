import type { Invoice } from "@/components/invoices";
import { approvalErrorHebrew, readinessBlockReasonHebrew } from "@/lib/documents/presentation";

export type InvoiceCompletionActionKind =
  | "approve_only"
  | "complete_details"
  | "complete_and_approve"
  | "edit_supplier"
  | "blocked"
  | "none";

export type InvoiceCompletionAction = {
  kind: InvoiceCompletionActionKind;
  primaryLabel: string;
  canApproveWithoutEdit: boolean;
  hint?: string;
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

export function inferInvoiceCompletionFlags(invoice: Invoice): { dataComplete: boolean; approvalRequired: boolean } {
  if (typeof invoice.dataComplete === "boolean" && typeof invoice.approvalRequired === "boolean") {
    return { dataComplete: invoice.dataComplete, approvalRequired: invoice.approvalRequired };
  }

  const missing =
    invoice.missingDataReasons ??
    (invoice.completionReasons ?? []).filter((reason) => MISSING_FIELD_MARKERS.some((marker) => reason.includes(marker)));
  const approval =
    invoice.approvalReasons ??
    (invoice.completionReasons ?? []).filter((reason) => reason.includes("ממתין לאישור") || reason.includes("רמת ביטחון") || reason.includes("כמה סכומים"));

  return {
    dataComplete: missing.length === 0,
    approvalRequired: approval.length > 0 || invoice.reviewStatus === "needs_review",
  };
}

export function getInvoiceCompletionAction(invoice: Invoice): InvoiceCompletionAction {
  if (invoice.source === "invoice" || !resolveInvoiceCompletionSourceType(invoice)) {
    return { kind: "none", primaryLabel: "", canApproveWithoutEdit: false };
  }

  const { dataComplete, approvalRequired } = inferInvoiceCompletionFlags(invoice);
  const blockHint = invoice.approvalBlockReason
    ? readinessBlockReasonHebrew({ blockReason: invoice.approvalBlockReason })
    : undefined;

  if (invoice.approvalBlockReason === "blocked_outcome" || blockHint?.includes("חסום")) {
    return {
      kind: "blocked",
      primaryLabel: "חסום",
      canApproveWithoutEdit: false,
      hint: blockHint ?? "המסמך חסום ולא ניתן לאשר אותו מכאן",
    };
  }

  if (invoice.supplierNeedsConfirmation || invoice.approvalBlockReason === "supplier.needs_confirmation") {
    return {
      kind: "edit_supplier",
      primaryLabel: "ערוך ספק",
      canApproveWithoutEdit: false,
      hint: "יש לאשר או לערוך את שם הספק לפני האישור",
    };
  }

  if (dataComplete && approvalRequired && invoice.canApproveDirectly === true) {
    return { kind: "approve_only", primaryLabel: "אשר", canApproveWithoutEdit: true };
  }

  if (dataComplete && approvalRequired) {
    return {
      kind: "complete_details",
      primaryLabel: "השלם פרטים",
      canApproveWithoutEdit: false,
      hint: blockHint ?? "יש להשלים פרטים לפני אישור",
    };
  }

  if (!dataComplete && approvalRequired) {
    return { kind: "complete_and_approve", primaryLabel: "השלם ואשר", canApproveWithoutEdit: false };
  }

  if (!dataComplete) {
    return { kind: "complete_details", primaryLabel: "השלם פרטים", canApproveWithoutEdit: false };
  }

  return { kind: "none", primaryLabel: "", canApproveWithoutEdit: false };
}

export function completionSuccessMessage(kind: InvoiceCompletionActionKind): string {
  if (kind === "approve_only") return "החשבונית אושרה והועברה למסך חשבוניות";
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

export function missingFieldKeys(invoice: Invoice): Set<"supplier" | "amount" | "date" | "currency" | "documentType"> {
  const keys = new Set<"supplier" | "amount" | "date" | "currency" | "documentType">();
  for (const reason of invoice.missingDataReasons ?? []) {
    if (reason.includes("ספק")) keys.add("supplier");
    if (reason.includes("סכום")) keys.add("amount");
    if (reason.includes("תאריך")) keys.add("date");
    if (reason.includes("מטבע")) keys.add("currency");
    if (reason.includes("סוג מסמך")) keys.add("documentType");
  }
  if (invoice.supplierNeedsConfirmation) keys.add("supplier");
  return keys;
}
