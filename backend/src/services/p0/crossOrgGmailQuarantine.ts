import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { isAllowlistedGmailMessageId } from "./sharonContaminationAllowlist.js";

export const CROSS_ORG_QUARANTINE_MARKER = "Quarantined: cross-org gmail ingestion";

export type QuarantineMarkerFields = {
  reviewStatus?: string | null;
  decisionReason?: string | null;
  uncertaintyReason?: string | null;
  duplicateReason?: string | null;
};

export function hasQuarantineMarker(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => typeof value === "string" && value.includes(CROSS_ORG_QUARANTINE_MARKER));
}

export function isQuarantinedGmailScanItem(item: {
  reviewStatus?: string | null;
  decisionReason?: string | null;
}): boolean {
  if (item.reviewStatus === "rejected" && hasQuarantineMarker(item.decisionReason)) return true;
  return hasQuarantineMarker(item.decisionReason);
}

export function isQuarantinedFinancialDocumentReview(review: {
  reviewStatus?: string | null;
  uncertaintyReason?: string | null;
}): boolean {
  if (review.reviewStatus === "rejected" && hasQuarantineMarker(review.uncertaintyReason)) return true;
  return hasQuarantineMarker(review.uncertaintyReason);
}

export function isQuarantinedSupplierPayment(payment: {
  approvalStatus?: string | null;
  duplicateReason?: string | null;
}): boolean {
  return hasQuarantineMarker(payment.duplicateReason);
}

export function appendQuarantineMarker(existing: string | null | undefined, marker: string): string {
  const base = existing?.trim() ?? "";
  if (base.includes(marker)) return base;
  return base ? `${base}; ${marker}` : marker;
}

export async function listCrossOrgContaminatedGmailMessageIds(
  db: Pick<PrismaClient, "$queryRawUnsafe"> = defaultPrisma,
): Promise<string[]> {
  const rows = (await db.$queryRawUnsafe(`
    SELECT "gmailMessageId" AS gmail_id
    FROM "GmailScanItem"
    WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
    GROUP BY "gmailMessageId"
    HAVING COUNT(DISTINCT "organizationId") > 1
  `)) as Array<{ gmail_id: string }>;
  return rows.map((row) => row.gmail_id).filter(Boolean);
}

/**
 * Same contamination predicate as {@link listCrossOrgContaminatedGmailMessageIds}
 * (GROUP BY gmailMessageId HAVING COUNT(DISTINCT organizationId) > 1), but only for
 * the candidate IDs that can affect a scoped read (e.g. pending FDR for one org).
 * Uses existing @@index([gmailMessageId]) via WHERE … = ANY(...).
 */
export async function listCrossOrgContaminatedGmailMessageIdsAmong(
  gmailMessageIds: string[],
  db: Pick<PrismaClient, "$queryRawUnsafe"> = defaultPrisma,
): Promise<string[]> {
  const unique = [
    ...new Set(gmailMessageIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ];
  if (unique.length === 0) return [];

  const rows = (await db.$queryRawUnsafe(
    `
    SELECT "gmailMessageId" AS gmail_id
    FROM "GmailScanItem"
    WHERE "gmailMessageId" = ANY($1::text[])
    GROUP BY "gmailMessageId"
    HAVING COUNT(DISTINCT "organizationId") > 1
    `,
    unique,
  )) as Array<{ gmail_id: string }>;
  return rows.map((row) => row.gmail_id).filter(Boolean);
}

export async function isCrossOrgContaminatedGmailMessageId(
  gmailMessageId: string | null | undefined,
  organizationId?: string | null,
  contaminatedIds?: Set<string>,
): Promise<boolean> {
  if (!gmailMessageId?.trim()) return false;
  if (organizationId && isAllowlistedGmailMessageId(gmailMessageId)) return false;
  const set =
    contaminatedIds ??
    new Set(await listCrossOrgContaminatedGmailMessageIds());
  return set.has(gmailMessageId);
}

export function buildCrossOrgQuarantineUpdate() {
  return {
    gsi: {
      reviewStatus: "rejected" as const,
      decisionReason: CROSS_ORG_QUARANTINE_MARKER,
    },
    fdr: {
      reviewStatus: "rejected" as const,
      uncertaintyReason: CROSS_ORG_QUARANTINE_MARKER,
    },
    payment: {
      approvalStatus: "needs_review" as const,
      duplicateDetected: true,
      duplicateReason: CROSS_ORG_QUARANTINE_MARKER,
    },
  };
}
