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

function quarantineMarkerExclusion(field: "decisionReason") {
  // decisionReason is required on GmailScanItem — plain NOT contains is safe.
  return {
    NOT: {
      [field]: { contains: CROSS_ORG_QUARANTINE_MARKER },
    },
  } satisfies Prisma.GmailScanItemWhereInput;
}

/**
 * SQL/Prisma `NOT (field CONTAINS …)` drops NULL rows. Camera/manual payments and
 * reviews often have null uncertainty/duplicate reasons — they must stay visible.
 */
function nullableQuarantineMarkerExclusion(field: "uncertaintyReason" | "duplicateReason") {
  return {
    OR: [{ [field]: null }, { NOT: { [field]: { contains: CROSS_ORG_QUARANTINE_MARKER } } }],
  };
}

function andIsolationClauses(...parts: Array<Record<string, unknown>>) {
  const present = parts.filter((part) => Object.keys(part).length > 0);
  if (present.length === 0) return {};
  if (present.length === 1) return present[0]!;
  return { AND: present };
}

/**
 * SQL/Prisma `field NOT IN (...)` excludes NULL rows. Camera/manual documents
 * often have null gmail/email ids — they must stay visible on invoice screens.
 */
function notInOrNull(field: "gmailMessageId" | "emailMessageId", excludedIds: string[]) {
  return {
    OR: [{ [field]: null }, { [field]: { notIn: excludedIds } }],
  };
}

export function buildGmailScanItemReadIsolationWhere(
  organizationId: string,
  contaminatedGmailIds: string[],
): Prisma.GmailScanItemWhereInput {
  const excludedGmailIds = crossOrgGmailIdsExcludedForOrganization(organizationId, contaminatedGmailIds);
  // GmailScanItem.gmailMessageId is required (non-null). Prisma rejects
  // `{ gmailMessageId: null }` with "Argument gmailMessageId is missing",
  // which 500'd GET /api/invoices via fetchEnrichedInvoiceListCandidates.
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
  return andIsolationClauses(
    nullableQuarantineMarkerExclusion("uncertaintyReason"),
    excludedGmailIds.length > 0 ? notInOrNull("gmailMessageId", excludedGmailIds) : {},
  ) as Prisma.FinancialDocumentReviewWhereInput;
}

export function buildSupplierPaymentReadIsolationWhere(
  organizationId: string,
  contaminatedGmailIds: string[],
): Prisma.SupplierPaymentWhereInput {
  const excludedGmailIds = crossOrgGmailIdsExcludedForOrganization(organizationId, contaminatedGmailIds);
  return andIsolationClauses(
    nullableQuarantineMarkerExclusion("duplicateReason"),
    excludedGmailIds.length > 0 ? notInOrNull("emailMessageId", excludedGmailIds) : {},
  ) as Prisma.SupplierPaymentWhereInput;
}

export function mergePrismaWhere<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown>): T {
  return { ...base, ...extra } as T;
}
