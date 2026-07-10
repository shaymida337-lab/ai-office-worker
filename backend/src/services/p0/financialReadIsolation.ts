import type { Prisma } from "@prisma/client";
import {
  CROSS_ORG_QUARANTINE_MARKER,
  listCrossOrgContaminatedGmailMessageIds,
} from "./crossOrgGmailQuarantine.js";
import { isAllowlistedGmailMessageId, SHARON_CONFIRMED_ALLOWLIST } from "./sharonContaminationAllowlist.js";

let contaminatedGmailIdsCache: { expiresAt: number; ids: string[] } | null = null;
const CONTAMINATED_IDS_CACHE_MS = 30_000;

export async function loadCrossOrgContaminatedGmailIdsForReads(): Promise<string[]> {
  const now = Date.now();
  if (contaminatedGmailIdsCache && contaminatedGmailIdsCache.expiresAt > now) {
    return contaminatedGmailIdsCache.ids;
  }
  const ids = await listCrossOrgContaminatedGmailMessageIds();
  contaminatedGmailIdsCache = { ids, expiresAt: now + CONTAMINATED_IDS_CACHE_MS };
  return ids;
}

export function resetCrossOrgContaminatedGmailIdsCacheForTests(): void {
  contaminatedGmailIdsCache = null;
}

export function crossOrgGmailIdsExcludedForOrganization(
  organizationId: string,
  contaminatedGmailIds: string[],
): string[] {
  return contaminatedGmailIds.filter((gmailMessageId) => {
    if (
      isAllowlistedGmailMessageId(gmailMessageId) &&
      organizationId === SHARON_CONFIRMED_ALLOWLIST.organizationId
    ) {
      return false;
    }
    return true;
  });
}

function quarantineMarkerExclusion(field: "decisionReason" | "uncertaintyReason" | "duplicateReason") {
  return {
    NOT: {
      [field]: { contains: CROSS_ORG_QUARANTINE_MARKER },
    },
  } satisfies Prisma.GmailScanItemWhereInput | Prisma.FinancialDocumentReviewWhereInput | Prisma.SupplierPaymentWhereInput;
}

export function buildGmailScanItemReadIsolationWhere(
  organizationId: string,
  contaminatedGmailIds: string[],
): Prisma.GmailScanItemWhereInput {
  const excludedGmailIds = crossOrgGmailIdsExcludedForOrganization(organizationId, contaminatedGmailIds);
  return {
    ...quarantineMarkerExclusion("decisionReason"),
    ...(excludedGmailIds.length > 0 ? { gmailMessageId: { notIn: excludedGmailIds } } : {}),
  };
}

export function buildFinancialDocumentReviewReadIsolationWhere(
  organizationId: string,
  contaminatedGmailIds: string[],
): Prisma.FinancialDocumentReviewWhereInput {
  const excludedGmailIds = crossOrgGmailIdsExcludedForOrganization(organizationId, contaminatedGmailIds);
  return {
    ...quarantineMarkerExclusion("uncertaintyReason"),
    ...(excludedGmailIds.length > 0 ? { gmailMessageId: { notIn: excludedGmailIds } } : {}),
  };
}

export function buildSupplierPaymentReadIsolationWhere(
  organizationId: string,
  contaminatedGmailIds: string[],
): Prisma.SupplierPaymentWhereInput {
  const excludedGmailIds = crossOrgGmailIdsExcludedForOrganization(organizationId, contaminatedGmailIds);
  return {
    ...quarantineMarkerExclusion("duplicateReason"),
    ...(excludedGmailIds.length > 0 ? { gmailMessageId: { notIn: excludedGmailIds } } : {}),
  };
}

export function mergePrismaWhere<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown>): T {
  return { ...base, ...extra } as T;
}
