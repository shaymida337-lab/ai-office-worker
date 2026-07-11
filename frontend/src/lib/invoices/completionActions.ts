import type { Invoice } from "@/components/invoices";
import { approvalErrorHebrew } from "@/lib/documents/presentation";

export type InvoiceCompletionActionKind = "approve_only" | "complete_details" | "complete_and_approve" | "none";

export type InvoiceCompletionAction = {
  kind: InvoiceCompletionActionKind;
  primaryLabel: string;
  canApproveWithoutEdit: boolean;
};

export type InvoiceCompletionResponse = {
  dataComplete: boolean;
  approved: boolean;
  destination: "invoices" | "completion";
  invoice: Invoice;
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

export function getInvoiceCompletionAction(invoice: Invoice): InvoiceCompletionAction {
  if (invoice.source === "invoice" || !resolveInvoiceCompletionSourceType(invoice)) {
    return { kind: "none", primaryLabel: "", canApproveWithoutEdit: false };
  }

  const dataComplete = invoice.dataComplete ?? false;
  const approvalRequired = invoice.approvalRequired ?? false;

  if (dataComplete && approvalRequired) {
    return { kind: "approve_only", primaryLabel: "אשר", canApproveWithoutEdit: true };
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
  if (message.includes("חסום")) return message;
  if (message.includes("GSI_APPROVE_REQUIRES_REVIEW")) return "לא ניתן לאשר — נדרש קישור למסמך ביקורת";
  return approvalErrorHebrew(message) || "האישור נכשל. נסה שוב.";
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
  return keys;
}
