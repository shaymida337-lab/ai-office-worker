/**
 * READ-ONLY: find who Rnet FDR clusters with during completion scan dedupe.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import {
  buildInvoiceListQueryContext,
  buildInvoiceListWhereInput,
  mapDocumentReviewToInvoiceCandidate,
  mapGmailScanItemToInvoiceCandidate,
} from "./src/routes/api.ts";
import {
  dedupeCompletionCandidatesPreferGsi,
  isCompletionDedupeActionable,
  applyCompletionQueueFilters,
  COMPLETION_SCAN_MAX_SOURCE_ROWS,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
} from "./src/services/p0/financialReadIsolation.ts";
import { assessInvoiceCompleteness } from "./src/services/amount/invoiceCompleteness.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const FDR_ID = "cmqw3n5hx020dm92bp1joi8wu";
const GSI_ID = "cmqw3n5ug020fm92b5smx5bx1";
const FP = "87d30575d372c795d0c93e55fc3d293dcc1f2462a9bad9bf";

function mergePrismaWhere<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown>): T {
  return { AND: [base, extra] } as unknown as T;
}

function forceProdCompleteness<T extends Record<string, any>>(candidate: T): T {
  const a = assessInvoiceCompleteness({
    supplierName: candidate.supplierName,
    amount: candidate.amount,
    amountResolved: candidate.amountResolved,
    currency: candidate.currency,
    currencyExplicit: candidate.currencyExplicit,
    date: candidate.date,
    documentDateExplicit: candidate.documentDateExplicit,
    documentType: candidate.documentType,
    reviewStatus: candidate.reviewStatus,
    rawReviewStatus: candidate.rawReviewStatus,
    confidenceScore: candidate.confidenceScore,
    decisionReason: candidate.decisionReason,
    parsedFieldsJson: candidate.parsedFieldsJson,
    ingestSource: candidate.ingestSource,
  });
  return {
    ...candidate,
    dataComplete: a.dataComplete,
    approvalRequired: a.approvalRequired,
    isComplete: a.dataComplete && !a.approvalRequired,
    missingDataReasons: a.missingDataReasons,
    approvalReasons: a.approvalReasons,
    completionReasons: a.completionReasons,
  };
}

function completionDedupeRefs(candidate: any): string[] {
  const refs: string[] = [];
  if (candidate.gmailMessageId) refs.push(`gmail:${candidate.gmailMessageId}`);
  if (candidate.emailMessageId) refs.push(`email:${candidate.emailMessageId}`);
  const fingerprint = candidate.documentFingerprint ?? candidate.duplicateKey;
  if (fingerprint) refs.push(`fp:${fingerprint}`);
  return refs;
}

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const baseWhere = buildInvoiceListWhereInput(ctx);
    const whereInput = {
      ...baseWhere,
      gmailScanItemWhere: mergePrismaWhere(
        baseWhere.gmailScanItemWhere as any,
        buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
      ),
      financialDocumentReviewWhere: mergePrismaWhere(
        baseWhere.financialDocumentReviewWhere as any,
        buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
      ),
    };

    const gsiRows = await prisma.gmailScanItem.findMany({
      where: whereInput.gmailScanItemWhere,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: COMPLETION_SCAN_MAX_SOURCE_ROWS,
    });
    const fdrRows = await prisma.financialDocumentReview.findMany({
      where: whereInput.financialDocumentReviewWhere,
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: COMPLETION_SCAN_MAX_SOURCE_ROWS,
    });

    const candidates = [
      ...gsiRows.map((row: any) =>
        forceProdCompleteness({
          ...mapGmailScanItemToInvoiceCandidate(row),
          emailMessageId: row.emailMessageId,
          duplicateKey: row.duplicateKey,
          documentFingerprint: row.duplicateKey,
          _rawGsiId: row.id,
        }),
      ),
      ...fdrRows.map((row: any) =>
        forceProdCompleteness({
          ...mapDocumentReviewToInvoiceCandidate(row, ORG),
          emailMessageId: row.emailMessageId,
          documentFingerprint: row.documentFingerprint,
          duplicateKey: row.documentFingerprint,
          _rawFdrId: row.id,
        }),
      ),
    ];

    const rnet = candidates.find(
      (c: any) => String(c.id).includes(FDR_ID) || String(c._rawFdrId) === FDR_ID,
    );
    if (!rnet) {
      console.log(JSON.stringify({ error: "Rnet FDR not in mapped source candidates", fdrCount: fdrRows.length }));
      return;
    }

    const rnetRefs = new Set(completionDedupeRefs(rnet));
    const clusterBefore = candidates.filter((c: any) => {
      const refs = completionDedupeRefs(c);
      return refs.some((r) => rnetRefs.has(r)) || String(c.id).includes(FDR_ID) || String(c.id).includes(GSI_ID);
    });

    // Union-find style: expand cluster transitively
    let changed = true;
    const memberIds = new Set(clusterBefore.map((c: any) => c.id));
    while (changed) {
      changed = false;
      const refSet = new Set<string>();
      for (const c of candidates) {
        if (memberIds.has(c.id)) completionDedupeRefs(c).forEach((r) => refSet.add(r));
      }
      for (const c of candidates) {
        if (memberIds.has(c.id)) continue;
        if (completionDedupeRefs(c).some((r) => refSet.has(r))) {
          memberIds.add(c.id);
          changed = true;
        }
      }
    }
    const fullCluster = candidates.filter((c: any) => memberIds.has(c.id));

    const slim = (c: any) => ({
      id: c.id,
      source: c.source,
      reviewStatus: c.reviewStatus,
      rawReviewStatus: c.rawReviewStatus,
      actionable: isCompletionDedupeActionable(c),
      isComplete: c.isComplete,
      dataComplete: c.dataComplete,
      approvalRequired: c.approvalRequired,
      amount: c.amount,
      supplierName: c.supplierName,
      invoiceNumber: c.invoiceNumber,
      gmailMessageId: c.gmailMessageId,
      emailMessageId: c.emailMessageId,
      fingerprint: c.documentFingerprint ?? c.duplicateKey,
      refs: completionDedupeRefs(c),
      decisionReason: String(c.decisionReason || "").slice(0, 120),
    });

    const winner = dedupeCompletionCandidatesPreferGsi(fullCluster);
    const afterIncomplete = applyCompletionQueueFilters(winner as any);

    // Also check: does Rnet alone pass incomplete but lose when mixed with ALL candidates?
    const allDeduped = dedupeCompletionCandidatesPreferGsi(candidates);
    const rnetAfterAllDedupe = allDeduped.filter(
      (c: any) =>
        String(c.id).includes(FDR_ID) ||
        Number(c.amount) === 354 ||
        String(c.invoiceNumber || "").includes("OV255") ||
        String(c.documentFingerprint || c.duplicateKey || "") === FP,
    );
    const allIncomplete = applyCompletionQueueFilters(allDeduped as any);
    const rnetAfterIncomplete = allIncomplete.filter(
      (c: any) =>
        String(c.id).includes(FDR_ID) ||
        Number(c.amount) === 354 ||
        String(c.invoiceNumber || "").includes("OV255") ||
        String(c.documentFingerprint || c.duplicateKey || "") === FP,
    );

    // Who won the cluster that contained Rnet?
    const clusterWinner = winner.map(slim);
    const rnetStillInDeduped = allDeduped.some((c: any) => String(c.id).includes(FDR_ID));

    // Find if any OTHER candidate shares each specific ref
    const refOwners: Record<string, any[]> = {};
    for (const ref of rnetRefs) {
      refOwners[ref] = candidates
        .filter((c: any) => completionDedupeRefs(c).includes(ref))
        .map(slim);
    }

    const out = {
      rnet: slim(rnet),
      rnetRefs: [...rnetRefs],
      clusterSize: fullCluster.length,
      clusterBeforeDedupe: fullCluster.map(slim),
      clusterWinnerAfterDedupe: clusterWinner,
      clusterAfterIncomplete: afterIncomplete.map(slim),
      refOwners,
      allCandidates: {
        before: candidates.length,
        afterDedupe: allDeduped.length,
        afterIncomplete: allIncomplete.length,
        rnetStillInDeduped,
        rnetAfterAllDedupe: rnetAfterAllDedupe.map(slim),
        rnetAfterIncomplete: rnetAfterIncomplete.map(slim),
      },
      stage: !rnetStillInDeduped
        ? "DEDUPED_AWAY_by_shared_ref_cluster"
        : rnetAfterIncomplete.length === 0
          ? "DROPPED_BY_INCOMPLETE_OR_NONFINANCIAL_FILTER"
          : "SURVIVES_LOCAL_FULL_SCAN",
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-cluster-trace.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
