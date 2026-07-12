import type { Invoice } from "@/components/invoices";
import { COMPLETION_DOCUMENT_TYPES } from "@/lib/invoices/completionActions";
import { formatAmount } from "@/lib/format/amount";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function isEmailLike(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 && EMAIL_PATTERN.test(trimmed);
}

export function isTechnicalText(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "-" || trimmed === "—") return true;
  if (trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed) || trimmed.includes("#inbox")) return true;
  if (trimmed.includes("gmail-scan:") || trimmed.includes("document-review:")) return true;
  if (/paymentSupplier|extractDec|supplierName|needs_review|gmail-scan/i.test(trimmed)) return true;
  if (/[a-z][A-Z]/.test(trimmed)) return true;
  if (/^[a-z0-9._-]+$/i.test(trimmed) && /\d/.test(trimmed) && !/[\u0590-\u05FF]/.test(trimmed)) return true;
  return false;
}

export function displayBusinessSupplier(invoice: Invoice): string {
  const candidates = [invoice.supplierName?.trim(), invoice.client?.name?.trim()].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (!isEmailLike(candidate) && !isTechnicalText(candidate)) return candidate;
  }
  return "ספק לא זוהה";
}

export function displayDocumentTypeLabel(documentType: string | null | undefined): string {
  if (!documentType?.trim() || isTechnicalText(documentType)) return "לא צוין";
  const match = COMPLETION_DOCUMENT_TYPES.find((type) => type.value === documentType);
  return match?.label ?? documentType;
}

export function displayInvoiceDate(date: string | null | undefined): string {
  if (!date) return "ללא תאריך";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "ללא תאריך";
  return parsed.toLocaleDateString("he-IL");
}

export function displayInvoiceAmount(invoice: Invoice): string {
  if (invoice.amountLabel && !isTechnicalText(invoice.amountLabel)) return invoice.amountLabel;
  if (invoice.amount == null || !Number.isFinite(invoice.amount)) return "ללא סכום";
  return formatAmount(invoice.amount, invoice.currency, "ללא סכום");
}

export function displayPaymentStatus(invoice: Invoice): string {
  if (invoice.reviewStatus === "rejected") return "נדחה";
  if (invoice.reviewStatus === "needs_review") return "ממתין לאישור";
  if (invoice.status === "paid") return "שולמה";
  if (invoice.status === "overdue") return "באיחור";
  return "ממתינה לתשלום";
}

export function paymentStatusTone(invoice: Invoice): "success" | "warn" | "danger" {
  if (invoice.reviewStatus === "rejected") return "danger";
  if (invoice.reviewStatus === "needs_review") return "warn";
  if (invoice.status === "paid") return "success";
  if (invoice.status === "overdue") return "danger";
  return "warn";
}
