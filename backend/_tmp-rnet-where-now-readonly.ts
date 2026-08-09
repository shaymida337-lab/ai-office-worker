/**
 * READ-ONLY: confirm FDR still matches completion source where right now.
 */
import { existsSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { buildInvoiceListQueryContext, buildInvoiceListWhereInput } from "./src/routes/api.ts";
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

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const base = buildInvoiceListWhereInput(ctx);
    const fdrWhere = mergePrismaWhere(
      base.financialDocumentReviewWhere as any,
      buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
    );
    const gsiWhere = mergePrismaWhere(
      base.gmailScanItemWhere as any,
      buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
    );
    const fdr = await prisma.financialDocumentReview.findUnique({
      where: { id: FDR },
      select: {
        id: true,
        reviewStatus: true,
        documentType: true,
        invoiceNumber: true,
        documentFingerprint: true,
        supplierPaymentId: true,
        uncertaintyReason: true,
      },
    });
    const fdrIn = await prisma.financialDocumentReview.findFirst({
      where: { AND: [{ id: FDR }, fdrWhere] },
      select: { id: true },
    });
    const fdrCount = await prisma.financialDocumentReview.count({ where: fdrWhere });
    const gsiCount = await prisma.gmailScanItem.count({ where: gsiWhere });
    console.log(
      JSON.stringify(
        {
          fdr,
          fdrInWhere: !!fdrIn,
          fdrSourceCount: fdrCount,
          gsiSourceCount: gsiCount,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
