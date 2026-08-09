import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { join } from "path";
import { assessInvoiceCompleteness } from "./src/services/amount/invoiceCompleteness.ts";

config({ path: join(process.cwd(), ".env") });
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const ids = ["19f9d94e7020adb7", "19f9d94a517d5d86", "19f9d7eb3bad3371"];
const u = new URL(process.env.PROD_DATABASE_URL);
u.searchParams.set("pgbouncer", "true");
const p = new PrismaClient({ datasources: { db: { url: u.toString() } } });

const since = new Date("2026-07-26T10:34:00Z");
const gsi = await p.gmailScanItem.findMany({
  where: {
    organizationId: ORG,
    OR: [{ gmailMessageId: { in: ids } }, { createdAt: { gte: since } }],
  },
  orderBy: { createdAt: "desc" },
});
const fdr = await p.financialDocumentReview.findMany({
  where: {
    organizationId: ORG,
    OR: [{ gmailMessageId: { in: ids } }, { createdAt: { gte: since } }],
  },
  orderBy: { createdAt: "desc" },
});

const third = ids[0];
const thirdGsiAnywhere = await p.gmailScanItem.findMany({
  where: { gmailMessageId: third },
  select: { id: true, organizationId: true, attachmentFilename: true, createdAt: true },
});
const thirdFdrAnywhere = await p.financialDocumentReview.findMany({
  where: { gmailMessageId: third },
  select: { id: true, organizationId: true, fileName: true, createdAt: true, uncertaintyReason: true },
});

const invoiceFdrs = fdr.filter((x) => ids.includes(x.gmailMessageId || ""));
const routing = invoiceFdrs.map((item) => {
  const amount = item.totalAmount;
  const assessment = assessInvoiceCompleteness({
    supplierName: item.supplierName,
    amount,
    amountResolved: typeof amount === "number" && Number.isFinite(amount) && amount > 0,
    currency: item.currency,
    currencyExplicit: Boolean(item.currency?.trim()),
    date: item.normalizedDocumentDate ?? item.documentDate,
    documentDateExplicit: Boolean(item.normalizedDocumentDate ?? item.documentDate),
    documentType: item.documentType,
    reviewStatus: item.reviewStatus,
    rawReviewStatus: item.reviewStatus,
    confidenceScore: item.confidenceScore,
    decisionReason: item.uncertaintyReason,
    parsedFieldsJson: item.parsedFieldsJson,
    ingestSource: item.source,
  });
  return {
    gmailMessageId: item.gmailMessageId,
    fileName: item.fileName,
    supplierName: item.supplierName,
    totalAmount: item.totalAmount,
    reviewStatus: item.reviewStatus,
    uncertaintyReason: item.uncertaintyReason,
    screen: assessment.isComplete ? "חשבוניות" : "השלמת חשבוניות",
    isComplete: assessment.isComplete,
    approvalRequired: assessment.approvalRequired,
    missingDataReasons: assessment.missingDataReasons,
  };
});

console.log(
  JSON.stringify(
    {
      byTargetId: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            gsi: gsi
              .filter((x) => x.gmailMessageId === id)
              .map((x) => ({
                id: x.id,
                file: x.attachmentFilename,
                supplier: x.supplierName,
                amount: x.amount,
                status: x.reviewStatus,
              })),
            fdr: fdr
              .filter((x) => x.gmailMessageId === id)
              .map((x) => ({
                id: x.id,
                file: x.fileName,
                supplier: x.supplierName,
                amount: x.totalAmount,
                type: x.documentType,
                reason: x.uncertaintyReason,
              })),
          },
        ])
      ),
      thirdMessageAnywhere: { gsi: thirdGsiAnywhere, fdr: thirdFdrAnywhere },
      gsiSinceReconnectCount: gsi.filter((x) => x.createdAt >= since).length,
      fdrSinceReconnectCount: fdr.filter((x) => x.createdAt >= since).length,
      routingForThreeInvoices: routing,
    },
    null,
    2
  )
);
await p.$disconnect();
