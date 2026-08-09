/**
 * READ-ONLY: re-check FDR/GSI where membership using PRODUCTION shallow mergePrismaWhere.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import {
  buildInvoiceListQueryContext,
  buildInvoiceListWhereInput,
} from "./src/routes/api.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
  mergePrismaWhere,
} from "./src/services/p0/financialReadIsolation.ts";
import {
  dedupeCompletionCandidatesPreferGsi,
  applyCompletionQueueFilters,
  scanCompletionQueueFromSources,
  COMPLETION_SCAN_CHUNK,
  COMPLETION_SCAN_MAX_SOURCE_ROWS,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  mapDocumentReviewToInvoiceCandidate,
  mapGmailScanItemToInvoiceCandidate,
} from "./src/routes/api.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const FDR_ID = "cmqw3n5hx020dm92bp1joi8wu";
const GSI_ID = "cmqw3n5ug020fm92b5smx5bx1";

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
      includeApprovedInvoices: false,
      includeApprovedSupplierPayments: false,
      includeReviewCandidates: true,
      gmailScanItemWhere: mergePrismaWhere(
        baseWhere.gmailScanItemWhere as any,
        buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
      ),
      financialDocumentReviewWhere: mergePrismaWhere(
        baseWhere.financialDocumentReviewWhere as any,
        buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
      ),
    };

    const fdrIn = await prisma.financialDocumentReview.findFirst({
      where: { AND: [{ id: FDR_ID }, whereInput.financialDocumentReviewWhere] },
      select: { id: true },
    });
    const gsiIn = await prisma.gmailScanItem.findFirst({
      where: { AND: [{ id: GSI_ID }, whereInput.gmailScanItemWhere] },
      select: { id: true },
    });

    const gsiOrderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
    const fdrOrderBy = [
      { documentDate: "desc" as const },
      { createdAt: "desc" as const },
      { id: "desc" as const },
    ];

    const pageResult = await scanCompletionQueueFromSources(
      [
        {
          name: "gmail_scan_item",
          load: ({ skip, take }) =>
            prisma.gmailScanItem.findMany({
              where: whereInput.gmailScanItemWhere,
              orderBy: gsiOrderBy,
              skip,
              take,
            }),
          map: (row: any) => ({
            ...mapGmailScanItemToInvoiceCandidate(row),
            emailMessageId: row.emailMessageId,
            duplicateKey: row.duplicateKey,
            documentFingerprint: row.duplicateKey,
          }),
        },
        {
          name: "financial_document_review",
          load: ({ skip, take }) =>
            prisma.financialDocumentReview.findMany({
              where: whereInput.financialDocumentReviewWhere,
              orderBy: fdrOrderBy,
              skip,
              take,
            }),
          map: (row: any) => ({
            ...mapDocumentReviewToInvoiceCandidate(row, ORG),
            emailMessageId: row.emailMessageId,
            documentFingerprint: row.documentFingerprint,
            duplicateKey: row.documentFingerprint,
          }),
        },
      ],
      {
        page: 1,
        pageSize: 100,
        sort: "date_desc",
        chunk: COMPLETION_SCAN_CHUNK,
        maxSourceRows: COMPLETION_SCAN_MAX_SOURCE_ROWS,
        dedupeCandidates: dedupeCompletionCandidatesPreferGsi,
      },
    );

    const hit = (pageResult.rows || []).filter(
      (r: any) =>
        String(r.id).includes(FDR_ID) ||
        String(r.id).includes(GSI_ID) ||
        Number(r.amount) === 354 ||
        String(r.invoiceNumber || "").includes("OV255"),
    );

    // Also dump isolation where shapes
    const out = {
      mergeStyle: "production_shallow_spread",
      isolation: {
        contaminatedCount: contaminated.length,
        gsiIsolation: buildGmailScanItemReadIsolationWhere(ORG, contaminated),
        fdrIsolation: buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated),
      },
      membership: { fdrIn: !!fdrIn, gsiIn: !!gsiIn },
      page: {
        total: pageResult.total,
        hit: hit.map((r: any) => ({
          id: r.id,
          amount: r.amount,
          isComplete: r.isComplete,
          approvalRequired: r.approvalRequired,
          dataComplete: r.dataComplete,
          reviewStatus: r.reviewStatus,
          supplierName: r.supplierName,
        })),
      },
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-prod-merge-scan.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
