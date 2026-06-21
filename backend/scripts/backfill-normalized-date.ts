/**
 * Backfill normalizedDocumentDate on Invoice, FinancialDocumentReview, GmailScanItem.
 * Idempotent — only updates normalizedDocumentDate, safe to re-run.
 *
 * Run: cd backend && npx tsx scripts/backfill-normalized-date.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import {
  mapDocumentReviewToInvoiceCandidate,
  mapGmailScanItemToInvoiceCandidate,
} from "../src/routes/api.js";

const BATCH_SIZE = 200;

async function backfillInvoices() {
  let cursor: string | undefined;
  let updated = 0;

  while (true) {
    const rows = await prisma.invoice.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, date: true },
    });
    if (rows.length === 0) break;

    await prisma.$transaction(
      rows.map((row) =>
        prisma.invoice.update({
          where: { id: row.id },
          data: { normalizedDocumentDate: row.date },
        })
      )
    );

    updated += rows.length;
    cursor = rows[rows.length - 1]!.id;
    console.log(`[backfill] Invoice batch done — ${updated} total updated`);
  }

  return updated;
}

async function backfillFinancialDocumentReviews() {
  let cursor: string | undefined;
  let updated = 0;

  while (true) {
    const rows = await prisma.financialDocumentReview.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        sender: true,
        subject: true,
        fileName: true,
        invoiceNumber: true,
        documentDate: true,
        dueDate: true,
        totalAmount: true,
        currency: true,
        driveFileUrl: true,
        supplierName: true,
        confidenceScore: true,
        reviewStatus: true,
        uncertaintyReason: true,
        emailMessageId: true,
        gmailMessageId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (rows.length === 0) break;

    await prisma.$transaction(
      rows.map((row) => {
        const normalizedDocumentDate = mapDocumentReviewToInvoiceCandidate(row).date;
        return prisma.financialDocumentReview.update({
          where: { id: row.id },
          data: { normalizedDocumentDate },
        });
      })
    );

    updated += rows.length;
    cursor = rows[rows.length - 1]!.id;
    console.log(`[backfill] FinancialDocumentReview batch done — ${updated} total updated`);
  }

  return updated;
}

async function backfillGmailScanItems() {
  let cursor: string | undefined;
  let updated = 0;

  while (true) {
    const rows = await prisma.gmailScanItem.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        gmailMessageId: true,
        emailMessageId: true,
        gmailMessageLink: true,
        sender: true,
        senderEmail: true,
        subject: true,
        occurredAt: true,
        amount: true,
        supplierName: true,
        attachmentFilename: true,
        driveFileLink: true,
        confidenceScore: true,
        reviewStatus: true,
        decisionReason: true,
        rawAnalysis: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (rows.length === 0) break;

    await prisma.$transaction(
      rows.map((row) => {
        const normalizedDocumentDate = mapGmailScanItemToInvoiceCandidate(row).date;
        return prisma.gmailScanItem.update({
          where: { id: row.id },
          data: { normalizedDocumentDate },
        });
      })
    );

    updated += rows.length;
    cursor = rows[rows.length - 1]!.id;
    console.log(`[backfill] GmailScanItem batch done — ${updated} total updated`);
  }

  return updated;
}

async function main() {
  console.log("=== Backfill normalizedDocumentDate ===\n");
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  const invoiceCount = await backfillInvoices();
  const reviewCount = await backfillFinancialDocumentReviews();
  const gmailCount = await backfillGmailScanItems();

  console.log("\n=== Summary ===");
  console.log(`Invoice:                 ${invoiceCount} updated`);
  console.log(`FinancialDocumentReview: ${reviewCount} updated`);
  console.log(`GmailScanItem:           ${gmailCount} updated`);
  console.log(`Total:                   ${invoiceCount + reviewCount + gmailCount} updated`);
}

main()
  .catch((err) => {
    console.error("[backfill-normalized-date] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
