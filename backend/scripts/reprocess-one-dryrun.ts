/**
 * DRY-RUN only — never writes to DB (dryRun: true is hardcoded).
 * Run: cd backend && npx tsx scripts/reprocess-one-dryrun.ts <gmailScanItemId> [organizationId]
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { reprocessFinancialDocumentBySource } from "../src/services/reprocessFinancialDocument.js";

function formatSnapshot(label: string, snapshot: { supplier: string | null; amount: number | null; date: Date | null }) {
  const date = snapshot.date ? snapshot.date.toISOString().slice(0, 10) : "null";
  return `${label}: supplier="${snapshot.supplier ?? "null"}" amount=${snapshot.amount ?? "null"} date=${date}`;
}

async function main() {
  const gmailScanItemId = process.argv[2]?.trim();
  if (!gmailScanItemId) {
    console.error("Usage: npx tsx scripts/reprocess-one-dryrun.ts <gmailScanItemId> [organizationId]");
    process.exit(1);
  }

  let organizationId = process.argv[3]?.trim() ?? process.env.ORGANIZATION_ID?.trim();
  if (!organizationId) {
    const row = await prisma.gmailScanItem.findUnique({
      where: { id: gmailScanItemId },
      select: { organizationId: true },
    });
    organizationId = row?.organizationId;
  }
  if (!organizationId) {
    console.error("organizationId is required (argv[3], ORGANIZATION_ID env, or resolvable from gmailScanItemId)");
    process.exit(1);
  }

  console.log(`=== Reprocess DRY-RUN (read-only) ===`);
  console.log(`gmailScanItemId=${gmailScanItemId} organizationId=${organizationId}\n`);

  const result = await reprocessFinancialDocumentBySource({
    organizationId,
    gmailScanItemId,
    dryRun: true,
  });

  console.log(`source=${result.sourceTable} id=${result.sourceId}`);
  console.log(`gmailMessageId=${result.gmailMessageId ?? "null"} emailMessageId=${result.emailMessageId ?? "null"}`);
  console.log(formatSnapshot("before", result.before));
  console.log(formatSnapshot("after ", result.after));
  console.log(`wouldChange=${result.wouldChange}`);
  console.log(`parsedInvoiceNumber=${result.parsedInvoiceNumber ?? "null"}`);
  console.log(`dryRun=${result.dryRun} updated=${result.updated}`);
}

main()
  .catch((err) => {
    console.error("[reprocess-one-dryrun] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
