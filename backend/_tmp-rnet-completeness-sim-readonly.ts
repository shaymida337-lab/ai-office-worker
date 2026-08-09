/**
 * READ-ONLY: simulate prod completeness for Rnet FDR + check isolation filters.
 */
import { existsSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const RNET_FDR = "cmqw3n5hx020dm92bp1joi8wu";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";

async function main() {
  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const fdr = await prisma.financialDocumentReview.findUnique({ where: { id: RNET_FDR } });
    if (!fdr) throw new Error("missing");

    // Prod logic from 8aefc67 (NOT local dirty WIP)
    function hasValidSupplier(name: string | null | undefined) {
      const n = (name ?? "").trim();
      return n.length >= 2 && !/^לא זוהה|unknown|n\/?a$/i.test(n);
    }
    function hasValidAmount(amount: number | null | undefined) {
      return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
    }
    const approvalRequired = fdr.reviewStatus !== "approved" && fdr.reviewStatus !== "auto_saved" && fdr.reviewStatus !== "rejected";
    const missing: string[] = [];
    if (!hasValidSupplier(fdr.supplierName)) missing.push("supplier");
    if (!hasValidAmount(fdr.totalAmount)) missing.push("amount");
    if (!fdr.documentDate) missing.push("date");
    if (!fdr.currency) missing.push("currency");
    if (!fdr.documentType) missing.push("type");
    const dataComplete = missing.length === 0;
    const isCompleteProd = dataComplete && !approvalRequired;
    const isCompleteLocalWip = dataComplete;

    // Does FDR match completion where?
    const whereMatch = await prisma.financialDocumentReview.count({
      where: {
        organizationId: ORG,
        id: RNET_FDR,
        documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
        reviewStatus: { in: ["needs_review", "failed", "rejected"] },
      },
    });

    // Contaminated / isolation markers?
    const isolation = {
      uncertaintyReason: fdr.uncertaintyReason,
      reviewStatus: fdr.reviewStatus,
      source: fdr.source,
      organizationId: fdr.organizationId,
    };

    // How many FDR rows match completion where ordered by documentDate?
    const matching = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
        reviewStatus: { in: ["needs_review"] },
      },
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true, supplierName: true, documentDate: true, totalAmount: true, currency: true, reviewStatus: true },
    });
    const idx = matching.findIndex((r) => r.id === RNET_FDR);

    console.log(
      JSON.stringify(
        {
          fdr: {
            supplierName: fdr.supplierName,
            totalAmount: fdr.totalAmount,
            documentDate: fdr.documentDate,
            currency: fdr.currency,
            documentType: fdr.documentType,
            reviewStatus: fdr.reviewStatus,
          },
          missing,
          dataComplete,
          approvalRequired,
          isCompleteProd,
          isCompleteLocalWip,
          wouldAppearInCompletionProd: !isCompleteProd,
          wouldAppearInCompletionLocalWip: !isCompleteLocalWip,
          whereMatch,
          matchingCount: matching.length,
          rnetIndexAmongMatching: idx,
          isolation,
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
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
