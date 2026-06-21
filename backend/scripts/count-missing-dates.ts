/**
 * READ-ONLY — counts records with missing or pre-2020 invoice-related dates.
 * Run: cd backend && npx tsx scripts/count-missing-dates.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const CUTOFF = new Date("2020-01-01T00:00:00.000Z");

async function main() {
  console.log("=== Count missing / invalid invoice dates (read-only) ===\n");
  console.log(`Cutoff: ${CUTOFF.toISOString().slice(0, 10)} (before = invalid for grouping)\n`);

  const invoiceBeforeCutoff = await prisma.invoice.count({
    where: { date: { lt: CUTOFF } },
  });
  console.log(`1. Invoice — date before 2020-01-01: ${invoiceBeforeCutoff}`);

  const reviewNullDocumentDate = await prisma.financialDocumentReview.count({
    where: { documentDate: null },
  });
  console.log(`2. FinancialDocumentReview — documentDate is null: ${reviewNullDocumentDate}`);

  const reviewCoalescedBeforeCutoff = await prisma.financialDocumentReview.count({
    where: {
      OR: [
        { documentDate: { lt: CUTOFF } },
        { documentDate: null, createdAt: { lt: CUTOFF } },
      ],
    },
  });
  console.log(
    `3. FinancialDocumentReview — COALESCE(documentDate, createdAt) before 2020-01-01: ${reviewCoalescedBeforeCutoff}`
  );

  const gmailScanOccurredBeforeCutoff = await prisma.gmailScanItem.count({
    where: { occurredAt: { lt: CUTOFF } },
  });
  console.log(`4. GmailScanItem — occurredAt before 2020-01-01: ${gmailScanOccurredBeforeCutoff}`);

  console.log("\n=== Done (no writes) ===");
}

main()
  .catch((err) => {
    console.error("[count-missing-dates] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
