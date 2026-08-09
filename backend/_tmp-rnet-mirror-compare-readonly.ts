/**
 * READ-ONLY: why Rnet missing but עיריית present — mirror GSI + dedupe + filters.
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
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
  mergePrismaWhere,
} from "./src/services/p0/financialReadIsolation.ts";
import { shouldExcludeFromInvoiceCompletionQueue } from "./src/services/amount/invoiceCompleteness.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";

const CASES = [
  { label: "rnet_missing", fdrId: "cmqw3n5hx020dm92bp1joi8wu" },
  { label: "bezeq_missing", fdrId: "cmqw3onmp0227m92bemcb1bkm" },
  { label: "ramatgan_present", fdrId: "cmqxf61ak0b2zjx2dna3832rx" },
  { label: "detected_present", fdrId: "cmqxf65y40b31jx2d0snodln4" },
  { label: "shaykedma_missing", fdrId: "cmqxeh4bh0audjx2d6ncvt92u" },
];

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const baseWhere = buildInvoiceListWhereInput(ctx);
    const gsiWhere = mergePrismaWhere(
      baseWhere.gmailScanItemWhere as any,
      buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
    );
    const fdrWhere = mergePrismaWhere(
      baseWhere.financialDocumentReviewWhere as any,
      buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
    );

    const results = [];
    for (const c of CASES) {
      const fdr = await prisma.financialDocumentReview.findUnique({ where: { id: c.fdrId } });
      if (!fdr) {
        results.push({ ...c, error: "missing fdr" });
        continue;
      }
      const mirrors = await prisma.gmailScanItem.findMany({
        where: {
          organizationId: ORG,
          OR: [
            ...(fdr.documentFingerprint ? [{ duplicateKey: fdr.documentFingerprint }] : []),
            ...(fdr.emailMessageId ? [{ emailMessageId: fdr.emailMessageId }] : []),
            ...(fdr.gmailMessageId ? [{ gmailMessageId: fdr.gmailMessageId }] : []),
          ],
        },
      });
      const mirrorsInWhere = [];
      for (const m of mirrors) {
        const inWhere = await prisma.gmailScanItem.findFirst({
          where: { AND: [{ id: m.id }, gsiWhere] },
          select: { id: true },
        });
        mirrorsInWhere.push({
          id: m.id,
          reviewStatus: m.reviewStatus,
          decisionReason: String(m.decisionReason || "").slice(0, 120),
          inWhere: !!inWhere,
          documentType: m.documentType,
          amount: m.amount,
        });
      }
      const fdrInWhere = !!(await prisma.financialDocumentReview.findFirst({
        where: { AND: [{ id: fdr.id }, fdrWhere] },
        select: { id: true },
      }));

      const fdrCand = {
        ...mapDocumentReviewToInvoiceCandidate(fdr as any, ORG),
        emailMessageId: fdr.emailMessageId,
        documentFingerprint: fdr.documentFingerprint,
        duplicateKey: fdr.documentFingerprint,
      };
      const gsiCands = mirrors.map((m) => ({
        ...mapGmailScanItemToInvoiceCandidate(m as any),
        emailMessageId: m.emailMessageId,
        duplicateKey: m.duplicateKey,
        documentFingerprint: m.duplicateKey,
      }));

      // Simulate: only in-where sources (prod path)
      const sourceLike = [
        ...gsiCands.filter((_, i) => mirrorsInWhere[i]?.inWhere),
        ...(fdrInWhere ? [fdrCand] : []),
      ];
      const allMirrorsPair = [...gsiCands, fdrCand];

      const winnerInWhere = dedupeCompletionCandidatesPreferGsi(sourceLike);
      const winnerAllMirrors = dedupeCompletionCandidatesPreferGsi(allMirrorsPair);
      // OLD behavior: prefer GSI by source only (ignore actionable) — approximate by sorting GSI first and taking prefer without actionable
      // Simulate old: if any GSI in cluster, pick GSI
      const oldPreferGsi = (cands: any[]) => {
        if (cands.length <= 1) return cands;
        const gsi = cands.find((x) => x.source === "gmail_scan_item");
        return gsi ? [gsi] : [cands[0]];
      };

      results.push({
        label: c.label,
        fdr: {
          id: fdr.id,
          inWhere: fdrInWhere,
          reviewStatus: fdr.reviewStatus,
          documentType: fdr.documentType,
          amount: fdr.totalAmount,
          supplierName: fdr.supplierName,
          uncertaintyReason: String(fdr.uncertaintyReason || "").slice(0, 120),
          fingerprint: fdr.documentFingerprint,
          mapped: {
            isComplete: fdrCand.isComplete,
            dataComplete: fdrCand.dataComplete,
            approvalRequired: fdrCand.approvalRequired,
            actionable: isCompletionDedupeActionable(fdrCand),
            nonFinancial: shouldExcludeFromInvoiceCompletionQueue(fdrCand),
          },
        },
        mirrors: mirrorsInWhere,
        simInWhereOnly: {
          before: sourceLike.map((x) => ({ id: x.id, source: x.source, status: x.reviewStatus })),
          afterNewDedupe: winnerInWhere.map((x) => ({ id: x.id, source: x.source })),
          afterOldPreferGsi: oldPreferGsi(sourceLike).map((x) => ({ id: x.id, source: x.source })),
          afterIncompleteNew: applyCompletionQueueFilters(winnerInWhere as any).map((x) => x.id),
          afterIncompleteOld: applyCompletionQueueFilters(oldPreferGsi(sourceLike) as any).map((x) => x.id),
        },
        simAllMirrorsIncludingQuarantined: {
          before: allMirrorsPair.map((x) => ({
            id: x.id,
            source: x.source,
            status: x.reviewStatus,
            actionable: isCompletionDedupeActionable(x),
          })),
          afterNewDedupe: winnerAllMirrors.map((x) => x.id),
          afterOldPreferGsi: oldPreferGsi(allMirrorsPair).map((x) => x.id),
          afterIncompleteNew: applyCompletionQueueFilters(winnerAllMirrors as any).map((x) => x.id),
          afterIncompleteOld: applyCompletionQueueFilters(oldPreferGsi(allMirrorsPair) as any).map((x) => x.id),
        },
      });
    }

    writeFileSync(join(process.cwd(), "_tmp-rnet-mirror-compare.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
