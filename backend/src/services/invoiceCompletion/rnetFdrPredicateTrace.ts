/**
 * Temporary Rnet FDR predicate diagnosis — remove after root cause is confirmed.
 * All probes are id-scoped; never dump table rows; never mutate.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { CROSS_ORG_QUARANTINE_MARKER } from "../p0/crossOrgGmailQuarantine.js";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  crossOrgGmailIdsExcludedForOrganization,
  loadCrossOrgContaminatedGmailIdsForReads,
} from "../p0/financialReadIsolation.js";
import { RNET_COMPLETION_TRACE_FDR_ID } from "./completionQueueQuery.js";

const EXPECTED_ORG_ID = "cmqw27e43002bm92bmf9mjy1n";

const SAFE_FDR_SELECT = {
  id: true,
  organizationId: true,
  reviewStatus: true,
  documentType: true,
  source: true,
  gmailMessageId: true,
  documentFingerprint: true,
  uncertaintyReason: true,
} as const;

export type RnetFdrSafeRow = {
  id: string;
  organizationId: string;
  reviewStatus: string;
  documentType: string;
  source: string;
  gmailMessageId: string | null;
  documentFingerprint: string;
  uncertaintyReason: string | null;
};

export type RnetPredicateProbe = {
  stage: string;
  matched: boolean;
};

function logPredicate(payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      tag: "rnet_completion_trace",
      stage: "fdrPredicate",
      ...payload,
    }),
  );
}

function asInList(value: unknown): string[] | null {
  if (!value || typeof value !== "object") return null;
  const inner = (value as { in?: unknown }).in;
  if (!Array.isArray(inner)) return null;
  return inner.map((v) => String(v));
}

export function slimRnetFdrSafeFields(
  row: RnetFdrSafeRow,
  expectedOrgId: string,
  excludedGmailIds: string[],
): Record<string, unknown> {
  const uncertainty = row.uncertaintyReason;
  const gmailId = row.gmailMessageId;
  return {
    found: true,
    orgIdMatches: row.organizationId === expectedOrgId,
    organizationIdEqualsExpected: row.organizationId === expectedOrgId,
    reviewStatus: row.reviewStatus,
    documentType: row.documentType,
    source: row.source,
    hasGmailMessageId: Boolean(String(gmailId ?? "").trim()),
    gmailMessageIdIsNull: gmailId == null,
    gmailMessageIdInContaminatedList:
      gmailId != null && excludedGmailIds.includes(gmailId),
    hasFingerprint: Boolean(String(row.documentFingerprint ?? "").trim()),
    uncertaintyReasonIsNull: uncertainty == null,
    uncertaintyReasonHasQuarantineMarker:
      typeof uncertainty === "string" && uncertainty.includes(CROSS_ORG_QUARANTINE_MARKER),
    uncertaintyReasonKind:
      uncertainty === null
        ? "null"
        : uncertainty === undefined
          ? "undefined"
          : typeof uncertainty,
  };
}

/**
 * In-memory first failing predicate vs completion FDR where shape.
 * Order mirrors cumulative probes A→isolation→full.
 */
export function evaluateFirstFailingRnetFdrPredicate(input: {
  row: RnetFdrSafeRow;
  organizationId: string;
  reviewStatusIn: string[] | null;
  documentTypeIn: string[] | null;
  excludedGmailIds: string[];
}): string | null {
  const { row, organizationId, reviewStatusIn, documentTypeIn, excludedGmailIds } = input;
  if (row.organizationId !== organizationId) return "organizationId";
  if (reviewStatusIn && !reviewStatusIn.includes(row.reviewStatus)) return "reviewStatus.in";
  if (documentTypeIn && !documentTypeIn.includes(row.documentType)) return "documentType.in";

  const uncertaintyOk =
    row.uncertaintyReason == null ||
    !String(row.uncertaintyReason).includes(CROSS_ORG_QUARANTINE_MARKER);
  if (!uncertaintyOk) return "isolation.uncertaintyReason_quarantine_or";

  if (excludedGmailIds.length > 0) {
    const gmailOk =
      row.gmailMessageId == null || !excludedGmailIds.includes(row.gmailMessageId);
    if (!gmailOk) return "isolation.gmailMessageId_contaminated_or";
  }
  return null;
}

export function buildRnetFdrIsolationBranchProbes(
  organizationId: string,
  contaminatedGmailIds: string[],
): Array<{ stage: string; where: Prisma.FinancialDocumentReviewWhereInput }> {
  const excluded = crossOrgGmailIdsExcludedForOrganization(organizationId, contaminatedGmailIds);
  const branches: Array<{ stage: string; where: Prisma.FinancialDocumentReviewWhereInput }> = [
    {
      stage: "E.isolation_uncertainty_null",
      where: { uncertaintyReason: null },
    },
    {
      stage: "E.isolation_uncertainty_not_contains_marker",
      where: { NOT: { uncertaintyReason: { contains: CROSS_ORG_QUARANTINE_MARKER } } },
    },
    {
      stage: "E.isolation_uncertainty_or",
      where: {
        OR: [
          { uncertaintyReason: null },
          { NOT: { uncertaintyReason: { contains: CROSS_ORG_QUARANTINE_MARKER } } },
        ],
      },
    },
  ];
  if (excluded.length > 0) {
    branches.push(
      { stage: "E.isolation_gmail_null", where: { gmailMessageId: null } },
      {
        stage: "E.isolation_gmail_notIn_contaminated",
        where: { gmailMessageId: { notIn: excluded } },
      },
      {
        stage: "E.isolation_gmail_or",
        where: {
          OR: [{ gmailMessageId: null }, { gmailMessageId: { notIn: excluded } }],
        },
      },
    );
  } else {
    branches.push({
      stage: "E.isolation_gmail_skipped_empty_excluded",
      where: {},
    });
  }
  return branches;
}

async function probeMatched(
  prisma: PrismaClient,
  stage: string,
  where: Prisma.FinancialDocumentReviewWhereInput,
): Promise<RnetPredicateProbe> {
  const row = await prisma.financialDocumentReview.findFirst({
    where: { AND: [{ id: RNET_COMPLETION_TRACE_FDR_ID }, where] },
    select: { id: true },
  });
  const result = { stage, matched: Boolean(row) };
  logPredicate(result);
  return result;
}

/**
 * Runs id-scoped FDR predicate probes in the live request Prisma client.
 */
export async function runRnetFdrPredicateDiagnostics(input: {
  prisma: PrismaClient;
  organizationId: string;
  baseFdrWhere: Prisma.FinancialDocumentReviewWhereInput;
  fullFdrWhere: Prisma.FinancialDocumentReviewWhereInput;
}): Promise<{
  probes: RnetPredicateProbe[];
  firstFailingPredicate: string | null;
  idOnlyFound: boolean;
  prismaVsRaw?: { prismaFound: boolean; rawFound: boolean };
  safeFields?: Record<string, unknown>;
}> {
  const { prisma, organizationId, baseFdrWhere, fullFdrWhere } = input;
  const contaminatedGmailIds = await loadCrossOrgContaminatedGmailIdsForReads();
  const excludedGmailIds = crossOrgGmailIdsExcludedForOrganization(
    organizationId,
    contaminatedGmailIds,
  );
  const reviewStatusIn = asInList(baseFdrWhere.reviewStatus);
  const documentTypeIn = asInList(baseFdrWhere.documentType);
  const probes: RnetPredicateProbe[] = [];

  const idOnly = await prisma.financialDocumentReview.findFirst({
    where: { id: RNET_COMPLETION_TRACE_FDR_ID },
    select: SAFE_FDR_SELECT,
  });

  if (!idOnly) {
    const rawRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "FinancialDocumentReview" WHERE id = ${RNET_COMPLETION_TRACE_FDR_ID} LIMIT 1
    `;
    const rawFound = rawRows.length > 0;
    const prismaVsRaw = { prismaFound: false, rawFound };
    logPredicate({
      stage: "id-only",
      matched: false,
      found: false,
      prismaVsRaw,
    });
    probes.push({ stage: "id-only", matched: false });
    logPredicate({
      stage: "firstFailingPredicate",
      firstFailingPredicate: rawFound ? "prisma_model_miss_raw_hit" : "row_absent_in_db",
      prismaVsRaw,
    });
    return {
      probes,
      firstFailingPredicate: rawFound ? "prisma_model_miss_raw_hit" : "row_absent_in_db",
      idOnlyFound: false,
      prismaVsRaw,
    };
  }

  const safeFields = slimRnetFdrSafeFields(idOnly, EXPECTED_ORG_ID, excludedGmailIds);
  logPredicate({
    stage: "id-only",
    matched: true,
    ...safeFields,
    contaminatedExcludedCount: excludedGmailIds.length,
  });
  probes.push({ stage: "id-only", matched: true });

  const orgWhere: Prisma.FinancialDocumentReviewWhereInput = {
    organizationId,
  };
  probes.push(await probeMatched(prisma, "A.id+orgId", orgWhere));

  probes.push(
    await probeMatched(prisma, "B.id+orgId+reviewStatus", {
      ...orgWhere,
      ...(reviewStatusIn ? { reviewStatus: { in: reviewStatusIn } } : {}),
    }),
  );

  probes.push(
    await probeMatched(prisma, "C.id+orgId+documentType", {
      ...orgWhere,
      ...(documentTypeIn ? { documentType: { in: documentTypeIn } } : {}),
    }),
  );

  probes.push(
    await probeMatched(prisma, "D.id+orgId+isolation", {
      ...orgWhere,
      ...buildFinancialDocumentReviewReadIsolationWhere(organizationId, contaminatedGmailIds),
    }),
  );

  for (const branch of buildRnetFdrIsolationBranchProbes(organizationId, contaminatedGmailIds)) {
    if (Object.keys(branch.where).length === 0) {
      const skipped = { stage: branch.stage, matched: true };
      logPredicate({ ...skipped, note: "no_excluded_gmail_ids" });
      probes.push(skipped);
      continue;
    }
    probes.push(
      await probeMatched(prisma, branch.stage, {
        ...orgWhere,
        ...branch.where,
      }),
    );
  }

  probes.push(await probeMatched(prisma, "F.id+fullCompletionWhere", fullFdrWhere));

  const inMemoryFirstFailing = evaluateFirstFailingRnetFdrPredicate({
    row: idOnly,
    organizationId,
    reviewStatusIn,
    documentTypeIn,
    excludedGmailIds,
  });
  // Prefer ordered DB probe failures (A→F / isolation branches) as source of truth.
  const firstFalseProbe = probes.find((p) => p.stage !== "id-only" && !p.matched);
  let reportedFirst: string | null = firstFalseProbe?.stage ?? inMemoryFirstFailing;
  if (
    firstFalseProbe &&
    (firstFalseProbe.stage.startsWith("D.") ||
      firstFalseProbe.stage.startsWith("E.") ||
      firstFalseProbe.stage.startsWith("F.")) &&
    inMemoryFirstFailing
  ) {
    // Narrow isolation/full failures to the exact field predicate.
    reportedFirst = inMemoryFirstFailing;
  }

  logPredicate({
    stage: "firstFailingPredicate",
    firstFailingPredicate: reportedFirst,
    inMemoryFirstFailing,
    safeFields,
  });

  return {
    probes,
    firstFailingPredicate: reportedFirst,
    idOnlyFound: true,
    safeFields,
  };
}
