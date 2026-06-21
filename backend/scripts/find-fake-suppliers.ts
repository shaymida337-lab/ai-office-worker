/**
 * READ-ONLY — finds records whose supplierName passes isLikelyJunkSupplierName.
 * Run: cd backend && npx tsx scripts/find-fake-suppliers.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { isLikelyJunkSupplierName } from "../src/services/supplierNameValidation.js";

type TableName = "GmailScanItem" | "Invoice" | "FinancialDocumentReview";

function isNonEmptySupplierName(value: string | null | undefined) {
  return Boolean(value?.trim());
}

async function findJunkInTable(table: TableName) {
  const junk: Array<{ id: string; supplierName: string }> = [];

  if (table === "GmailScanItem") {
    const rows = await prisma.gmailScanItem.findMany({
      where: { supplierName: { not: "" } },
      select: { id: true, supplierName: true },
    });
    for (const row of rows) {
      if (!isNonEmptySupplierName(row.supplierName)) continue;
      if (isLikelyJunkSupplierName(row.supplierName)) {
        junk.push({ id: row.id, supplierName: row.supplierName.trim() });
      }
    }
    return junk;
  }

  if (table === "Invoice") {
    const rows = await prisma.invoice.findMany({
      where: { supplierName: { not: null } },
      select: { id: true, supplierName: true },
    });
    for (const row of rows) {
      if (!isNonEmptySupplierName(row.supplierName)) continue;
      if (isLikelyJunkSupplierName(row.supplierName)) {
        junk.push({ id: row.id, supplierName: row.supplierName!.trim() });
      }
    }
    return junk;
  }

  const rows = await prisma.financialDocumentReview.findMany({
    where: { supplierName: { not: null } },
    select: { id: true, supplierName: true },
  });
  for (const row of rows) {
    if (!isNonEmptySupplierName(row.supplierName)) continue;
    if (isLikelyJunkSupplierName(row.supplierName)) {
      junk.push({ id: row.id, supplierName: row.supplierName!.trim() });
    }
  }
  return junk;
}

async function main() {
  console.log("=== Find fake/junk supplier names (read-only) ===\n");
  console.log("Using isLikelyJunkSupplierName from supplierNameValidation.ts\n");

  const tables: TableName[] = ["GmailScanItem", "Invoice", "FinancialDocumentReview"];
  const counts: Record<TableName, number> = {
    GmailScanItem: 0,
    Invoice: 0,
    FinancialDocumentReview: 0,
  };

  for (const table of tables) {
    const junk = await findJunkInTable(table);
    counts[table] = junk.length;
    for (const row of junk) {
      console.log(`[junk] ${table} id=${row.id} supplier="${row.supplierName}"`);
    }
  }

  const total = counts.GmailScanItem + counts.Invoice + counts.FinancialDocumentReview;
  console.log("\n=== Summary ===");
  console.log(`GmailScanItem: ${counts.GmailScanItem}`);
  console.log(`Invoice: ${counts.Invoice}`);
  console.log(`FinancialDocumentReview: ${counts.FinancialDocumentReview}`);
  console.log(`Total junk supplier records: ${total}`);
}

main()
  .catch((err) => {
    console.error("[find-fake-suppliers] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
