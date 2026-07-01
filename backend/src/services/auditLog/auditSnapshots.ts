import type { Prisma } from "@prisma/client";

/** Safe JSON snapshot for audit before/after states. */
export function auditSnapshot<T extends Record<string, unknown>>(value: T | null | undefined): Prisma.InputJsonValue | null {
  if (!value) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return { _auditSnapshotError: true };
  }
}

export function paymentAuditSnapshot(payment: {
  id: string;
  supplier?: string | null;
  amount?: number | null;
  currency?: string | null;
  paid?: boolean | null;
  approvalStatus?: string | null;
  emailMessageId?: string | null;
  documentFingerprint?: string | null;
}) {
  return auditSnapshot({
    id: payment.id,
    supplier: payment.supplier ?? null,
    amount: payment.amount ?? null,
    currency: payment.currency ?? null,
    paid: payment.paid ?? null,
    approvalStatus: payment.approvalStatus ?? null,
    emailMessageId: payment.emailMessageId ?? null,
    documentFingerprint: payment.documentFingerprint ?? null,
  });
}

export function reviewAuditSnapshot(review: {
  id: string;
  reviewStatus?: string | null;
  documentType?: string | null;
  supplierName?: string | null;
  totalAmount?: number | null;
  gmailMessageId?: string | null;
  emailMessageId?: string | null;
}) {
  return auditSnapshot({
    id: review.id,
    reviewStatus: review.reviewStatus ?? null,
    documentType: review.documentType ?? null,
    supplierName: review.supplierName ?? null,
    totalAmount: review.totalAmount ?? null,
    gmailMessageId: review.gmailMessageId ?? null,
    emailMessageId: review.emailMessageId ?? null,
  });
}

export function invoiceAuditSnapshot(invoice: {
  id: string;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  gmailMessageId?: string | null;
  emailId?: string | null;
}) {
  return auditSnapshot({
    id: invoice.id,
    status: invoice.status ?? null,
    amount: invoice.amount ?? null,
    currency: invoice.currency ?? null,
    gmailMessageId: invoice.gmailMessageId ?? null,
    emailId: invoice.emailId ?? null,
  });
}
