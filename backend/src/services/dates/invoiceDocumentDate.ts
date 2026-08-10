import { normalizeBusinessDate } from "./businessDate.js";

/**
 * Resolve Gmail message sent time from Date header or internalDate.
 * Never invents "now" — returns null if neither source is valid.
 */
export function resolveGmailMessageReceivedAt(input: {
  dateHeader?: string | null;
  internalDate?: string | number | null;
}): Date | null {
  const header = (input.dateHeader ?? "").trim();
  if (header) {
    const fromHeader = new Date(header);
    if (Number.isFinite(fromHeader.getTime())) return fromHeader;
  }
  const raw = input.internalDate;
  const ms = typeof raw === "string" ? Number(raw) : raw ?? NaN;
  if (Number.isFinite(ms) && ms > 0) {
    const fromInternal = new Date(ms);
    if (Number.isFinite(fromInternal.getTime())) return fromInternal;
  }
  return null;
}

export type InvoiceDocumentDateSource = "document" | "email_sent" | null;

/**
 * Prefer OCR/AI invoice date; fall back to email sent time.
 * Never falls back to Date.now() / today.
 */
export function resolveInvoiceDocumentDate(input: {
  analysisInvoiceDate?: string | Date | null;
  extractedInvoiceDate?: string | Date | null;
  emailReceivedAt?: Date | null;
}): { date: Date | null; source: InvoiceDocumentDateSource } {
  const fromDocument = normalizeBusinessDate(
    input.analysisInvoiceDate ?? input.extractedInvoiceDate ?? null,
    null
  );
  if (fromDocument) return { date: fromDocument, source: "document" };

  const fromEmail = normalizeBusinessDate(input.emailReceivedAt ?? null, null);
  if (fromEmail) return { date: fromEmail, source: "email_sent" };

  return { date: null, source: null };
}

/** True when vendor + amount are present so the doc can auto-approve with an email date fallback. */
export function hasVendorAndAmountForAutoApprove(input: {
  supplierName?: string | null;
  amount?: number | null;
  isUsableSupplier: (name: string) => boolean;
}): boolean {
  const name = (input.supplierName ?? "").trim();
  if (!name || !input.isUsableSupplier(name)) return false;
  return typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0;
}
