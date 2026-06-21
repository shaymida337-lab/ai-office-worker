/**
 * Backfill normalizedDocumentDate on SupplierPayment from existing date field.
 * Idempotent — only updates rows where normalizedDocumentDate IS NULL.
 *
 * Run: cd backend && npx tsx scripts/backfill-payment-normalized-date.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const BATCH_SIZE = 200;

async function backfillSupplierPayments() {
  let cursor: string | undefined;
  let updated = 0;

  while (true) {
    const rows = await prisma.supplierPayment.findMany({
      take: BATCH_SIZE,
      where: { normalizedDocumentDate: null },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, date: true },
    });
    if (rows.length === 0) break;

    await prisma.$transaction(
      rows.map((row) =>
        prisma.supplierPayment.update({
          where: { id: row.id },
          data: { normalizedDocumentDate: row.date },
        })
      )
    );

    updated += rows.length;
    cursor = rows[rows.length - 1]!.id;
    console.log(`[backfill] SupplierPayment batch done — ${updated} total updated`);
  }

  return updated;
}

async function main() {
  console.log("=== Backfill SupplierPayment normalizedDocumentDate ===\n");
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  const paymentCount = await backfillSupplierPayments();

  console.log("\n=== Summary ===");
  console.log(`SupplierPayment: ${paymentCount} updated`);
}

main()
  .catch((err) => {
    console.error("[backfill-payment-normalized-date] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
