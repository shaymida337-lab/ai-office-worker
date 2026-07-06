import type { SupplierPayment } from "@prisma/client";

export const ZERO_AMOUNT_DATA_QUALITY_MARKER = "data_quality_issue:zero_amount";
export const NULL_FINGERPRINT_DATA_QUALITY_MARKER = "data_quality_issue:missing_document_fingerprint";

export function isPositivePaymentAmount(amount: number | null | undefined): boolean {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

export function hasDocumentFingerprint(fingerprint: string | null | undefined): boolean {
  return typeof fingerprint === "string" && fingerprint.trim().length > 0;
}

/** Approved supplier payments that count toward payable KPIs and dashboards. */
export function isPayableSupplierPayment(
  payment: Pick<SupplierPayment, "approvalStatus" | "amount" | "duplicateReason" | "paid">,
): boolean {
  if (payment.approvalStatus !== "approved") return false;
  if (!isPositivePaymentAmount(payment.amount)) return false;
  if (payment.duplicateReason?.includes(ZERO_AMOUNT_DATA_QUALITY_MARKER)) return false;
  if (payment.duplicateReason?.includes("Quarantined: cross-org gmail ingestion")) return false;
  return true;
}

export function assertNewSupplierPaymentQuality(input: {
  amount: number | null | undefined;
  documentFingerprint: string | null | undefined;
  documentType?: string | null;
}): void {
  if (!isPositivePaymentAmount(input.amount)) {
    throw new Error("SupplierPayment amount must be greater than zero");
  }
  if (!hasDocumentFingerprint(input.documentFingerprint)) {
    throw new Error("SupplierPayment documentFingerprint is required");
  }
}
