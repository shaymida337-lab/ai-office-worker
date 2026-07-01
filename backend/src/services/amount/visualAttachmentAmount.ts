import type { EmailAnalysis, InvoiceScanResult } from "../claude.js";
import { normalizePositiveAmount } from "./canonicalAmount.js";

function normalizeDetectedAmount(amount: number | null | undefined): number | null {
  return normalizePositiveAmount(amount);
}

export type VisualAttachmentAnalysis = Pick<
  EmailAnalysis,
  "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "confidence"
>;

export function invoiceScanToAttachmentAnalysis(
  scan: Pick<
    InvoiceScanResult,
    "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "ocrConfidence"
  >
): VisualAttachmentAnalysis | null {
  const amount = normalizeDetectedAmount(scan.totalAmount ?? scan.amount);
  const amountBeforeVat = normalizeDetectedAmount(scan.amountBeforeVat);
  const vatAmount = normalizeDetectedAmount(scan.vatAmount);
  if (amount == null && amountBeforeVat == null && vatAmount == null) {
    return null;
  }
  return {
    amount: amount ?? scan.amount ?? null,
    totalAmount: amount ?? scan.totalAmount ?? null,
    amountBeforeVat: scan.amountBeforeVat ?? null,
    vatAmount: scan.vatAmount ?? null,
    currency: scan.currency ?? "ILS",
    confidence: scan.ocrConfidence ?? 0.85,
  };
}

export function mergeVisualAttachmentAnalyses(
  current: VisualAttachmentAnalysis | null,
  next: VisualAttachmentAnalysis | null
): VisualAttachmentAnalysis | null {
  if (!next) return current;
  if (!current) return next;
  const currentAmount = normalizeDetectedAmount(current.totalAmount ?? current.amount);
  const nextAmount = normalizeDetectedAmount(next.totalAmount ?? next.amount);
  if (nextAmount == null) return current;
  if (currentAmount == null) return next;
  const currentConfidence = current.confidence ?? 0;
  const nextConfidence = next.confidence ?? 0;
  return nextConfidence >= currentConfidence ? next : current;
}
