import type { SupplierPayment } from "@prisma/client";

import { prisma } from "../../lib/prisma.js";

export type SupplierPaymentSourceLookup = {
  organizationId: string;
  emailMessageId?: string | null;
  gmailMessageId?: string | null;
  documentFingerprint?: string | null;
};

export function isActiveSupplierPayment(payment: Pick<SupplierPayment, "approvalStatus" | "paid">): boolean {
  if (payment.approvalStatus === "rejected") return false;
  return true;
}

export function pickCanonicalSupplierPayment<T extends Pick<SupplierPayment, "createdAt" | "id">>(
  payments: T[]
): T | null {
  if (!payments.length) return null;
  return [...payments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
}

export async function findActiveSupplierPaymentsForSource(
  input: SupplierPaymentSourceLookup
): Promise<SupplierPayment[]> {
  const whereClauses: Array<Record<string, unknown>> = [];

  if (input.documentFingerprint) {
    whereClauses.push({
      organizationId: input.organizationId,
      documentFingerprint: input.documentFingerprint,
    });
  }

  if (input.emailMessageId) {
    whereClauses.push({
      organizationId: input.organizationId,
      emailMessageId: input.emailMessageId,
    });
  }

  if (input.gmailMessageId) {
    const emailRows = await prisma.emailMessage.findMany({
      where: {
        organizationId: input.organizationId,
        gmailId: input.gmailMessageId,
      },
      select: { id: true },
    });
    for (const emailRow of emailRows) {
      whereClauses.push({
        organizationId: input.organizationId,
        emailMessageId: emailRow.id,
      });
    }
  }

  if (!whereClauses.length) return [];

  const rows = await prisma.supplierPayment.findMany({
    where: { OR: whereClauses },
    orderBy: { createdAt: "asc" },
  });

  const seen = new Set<string>();
  const uniqueRows: SupplierPayment[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    uniqueRows.push(row);
  }

  return uniqueRows.filter(isActiveSupplierPayment);
}

export async function findActiveSupplierPaymentForSource(
  input: SupplierPaymentSourceLookup
): Promise<SupplierPayment | null> {
  const rows = await findActiveSupplierPaymentsForSource(input);
  return pickCanonicalSupplierPayment(rows);
}

export function duplicateSupplierPaymentBlockReason(
  existing: Pick<SupplierPayment, "id" | "emailMessageId" | "documentFingerprint">
): string {
  return `duplicate_supplier_payment_source:${existing.id}`;
}
