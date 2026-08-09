import { existsSync } from "fs";
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
  scanCompletionQueueFromSources,
  COMPLETION_SCAN_CHUNK,
  COMPLETION_SCAN_MAX_SOURCE_ROWS,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
  mergePrismaWhere,
} from "./src/services/p0/financialReadIsolation.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const FDR = "cmqw3n5hx020dm92bp1joi8wu";

const u = new URL(process.env.PROD_DATABASE_URL!);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
try {
  const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
  const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
  const base = buildInvoiceListWhereInput(ctx);
  const whereInput = {
    gmailScanItemWhere: mergePrismaWhere(
      base.gmailScanItemWhere as any,
      buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
    ),
    financialDocumentReviewWhere: mergePrismaWhere(
      base.financialDocumentReviewWhere as any,
      buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
    ),
  };
  const scanned = await scanCompletionQueueFromSources(
    [
      {
        name: "gsi",
        load: ({ skip, take }) =>
          prisma.gmailScanItem.findMany({
            where: whereInput.gmailScanItemWhere,
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
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
        name: "fdr",
        load: ({ skip, take }) =>
          prisma.financialDocumentReview.findMany({
            where: whereInput.financialDocumentReviewWhere,
            orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
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
  const matched = scanned.matched || [];
  console.log(
    JSON.stringify({
      cleanReplayTotal: scanned.total,
      sourceRowsScanned: scanned.sourceRowsScanned,
      rnetInMatched: matched.some((c: any) => String(c.id).includes(FDR)),
    }),
  );
} finally {
  await prisma.$disconnect();
}
