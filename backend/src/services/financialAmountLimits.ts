export const MAX_REASONABLE_FINANCIAL_AMOUNT = 1_000_000;

/** Conservative review ceiling for retail receipts (ILS). */
export const RECEIPT_REVIEW_CEILING_ILS = 25_000;

/** Conservative review ceiling for tax invoices (ILS). */
export const TAX_INVOICE_REVIEW_CEILING_ILS = 250_000;

/** Conservative review ceiling for payment requests (ILS). */
export const PAYMENT_REQUEST_REVIEW_CEILING_ILS = 100_000;

export function documentTypeReviewCeiling(documentType: string): number | null {
  const normalized = documentType.toLowerCase();
  if (/receipt|קבלה/.test(normalized)) return RECEIPT_REVIEW_CEILING_ILS;
  if (/payment_request|payment request|דרישת|בקשת/.test(normalized)) return PAYMENT_REQUEST_REVIEW_CEILING_ILS;
  if (/invoice|tax_invoice|חשבונית/.test(normalized)) return TAX_INVOICE_REVIEW_CEILING_ILS;
  return null;
}
