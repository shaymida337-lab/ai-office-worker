/**
 * READ-ONLY: GSI documentType + simulate merge with real prod rows + check list filters
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { mergeInvoiceListCandidates } from "./src/routes/api.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") process.exit(2);

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

const GSI_TYPES = ["invoice", "receipt", "unknown_needs_review"];
const FDR_TYPES = ["tax_invoice", "receipt", "tax_invoice_receipt"];

async function main() {
  const pairs = [
    { label: "TIRE_450", fdrId: "cms1p5fn1008rj81sxvqogrc8", gsiId: "cms1p5nwl008xj81s2yeavjyx" },
    { label: "PHARM_918", fdrId: "cms1p5woj008zj81s99yq2wfp", gsiId: "cms1p5x0k0091j81sy1y0xkcr" },
  ];

  const out = [];
  for (const p of pairs) {
    const fdr = await prisma.financialDocumentReview.findFirst({ where: { id: p.fdrId, organizationId: ORG } });
    const gsi = await prisma.gmailScanItem.findFirst({ where: { id: p.gsiId, organizationId: ORG } });
    if (!fdr || !gsi) {
      out.push({ ...p, error: "missing" });
      continue;
    }

    const gsiInListFilter = GSI_TYPES.includes(gsi.documentType);
    const fdrInListFilter = FDR_TYPES.includes(fdr.documentType);

    const gmailScanItems = gsiInListFilter ? [gsi as any] : [];
    const documentReviews = fdrInListFilter ? [fdr as any] : [];
    const merged = mergeInvoiceListCandidates({
      invoiceRows: [],
      gmailScanItems,
      documentReviews,
      organizationId: ORG,
    });

    out.push({
      label: p.label,
      fdr: {
        id: fdr.id,
        documentType: fdr.documentType,
        reviewStatus: fdr.reviewStatus,
        gmailMessageId: fdr.gmailMessageId,
        emailMessageId: fdr.emailMessageId,
        supplierName: fdr.supplierName,
        totalAmount: fdr.totalAmount,
        fileName: fdr.fileName,
        documentFingerprint: fdr.documentFingerprint,
        source: fdr.source,
        createdAt: fdr.createdAt,
        inListFilter: fdrInListFilter,
      },
      gsi: {
        id: gsi.id,
        documentType: gsi.documentType,
        reviewStatus: gsi.reviewStatus,
        gmailMessageId: gsi.gmailMessageId,
        emailMessageId: gsi.emailMessageId,
        supplierName: gsi.supplierName,
        amount: gsi.amount,
        attachmentFilename: gsi.attachmentFilename,
        duplicateKey: gsi.duplicateKey,
        createdAt: gsi.createdAt,
        inListFilter: gsiInListFilter,
      },
      merge: {
        count: merged.length,
        ids: merged.map((m) => m.id),
        sources: merged.map((m) => m.source),
      },
      rootCauseHint:
        gsiInListFilter && fdrInListFilter && merged.length === 1
          ? "DB has FDR+GSI pair; merge correctly returns 1 — if UI shows 2, frontend/double-fetch"
          : gsiInListFilter && fdrInListFilter && merged.length === 2
            ? "MERGE BUG: both passed dedupe"
            : !gsiInListFilter && fdrInListFilter
              ? "Only FDR in list filter — UI should show 1 unless another source"
              : gsiInListFilter && !fdrInListFilter
                ? "Only GSI in list filter — UI should show 1"
                : "Neither in list filter",
    });
  }

  writeFileSync(join(process.cwd(), "_tmp-dup-merge-sim-real.json"), JSON.stringify({ out }, null, 2), "utf8");
  console.log(JSON.stringify({ out }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
}).finally(() => prisma.$disconnect());
