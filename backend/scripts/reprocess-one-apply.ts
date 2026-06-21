/**
 * Single-record reprocess apply — dry-run first, then IN-PLACE update if wouldChange.
 * Run: cd backend && npx tsx scripts/reprocess-one-apply.ts <recordId> [organizationId]
 * recordId prefixes: review_ → FinancialDocumentReview, invoice_ → Invoice, else GmailScanItem
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import {
  reprocessFinancialDocumentBySource,
  reprocessParamsFromRecordId,
} from "../src/services/reprocessFinancialDocument.js";

function formatSnapshot(label: string, snapshot: { supplier: string | null; amount: number | null; date: Date | null }) {
  const date = snapshot.date ? snapshot.date.toISOString().slice(0, 10) : "null";
  return `${label}: supplier="${snapshot.supplier ?? "null"}" amount=${snapshot.amount ?? "null"} date=${date}`;
}

async function resolveOrganizationId(
  recordId: string,
  sourceParams: ReturnType<typeof reprocessParamsFromRecordId>,
  explicitOrganizationId?: string
) {
  if (explicitOrganizationId) return explicitOrganizationId;
  const fromEnv = process.env.ORGANIZATION_ID?.trim();
  if (fromEnv) return fromEnv;

  if (sourceParams.financialDocumentReviewId) {
    const row = await prisma.financialDocumentReview.findUnique({
      where: { id: recordId },
      select: { organizationId: true },
    });
    return row?.organizationId;
  }

  if (sourceParams.invoiceId) {
    const row = await prisma.invoice.findUnique({
      where: { id: recordId },
      select: { organizationId: true },
    });
    return row?.organizationId;
  }

  const row = await prisma.gmailScanItem.findUnique({
    where: { id: recordId },
    select: { organizationId: true },
  });
  return row?.organizationId;
}

async function main() {
  const recordId = process.argv[2]?.trim();
  if (!recordId) {
    console.error("Usage: npx tsx scripts/reprocess-one-apply.ts <recordId> [organizationId]");
    process.exit(1);
  }

  const sourceParams = reprocessParamsFromRecordId(recordId);
  const sourceKind = sourceParams.financialDocumentReviewId
    ? "FinancialDocumentReview"
    : sourceParams.invoiceId
      ? "Invoice"
      : "GmailScanItem";

  const organizationId = await resolveOrganizationId(recordId, sourceParams, process.argv[3]?.trim());
  if (!organizationId) {
    console.error("organizationId is required (argv[3], ORGANIZATION_ID env, or resolvable from recordId)");
    process.exit(1);
  }

  const baseParams = { organizationId, ...sourceParams };

  console.log(`=== Reprocess APPLY (single record) ===`);
  console.log(`recordId=${recordId} sourceKind=${sourceKind} organizationId=${organizationId}\n`);

  console.log("--- Step 1: dry-run preview ---");
  const preview = await reprocessFinancialDocumentBySource({
    ...baseParams,
    dryRun: true,
  });

  console.log(`source=${preview.sourceTable} id=${preview.sourceId}`);
  console.log(`gmailMessageId=${preview.gmailMessageId ?? "null"} resolvedVia=${preview.gmailMessageIdResolvedVia ?? "null"}`);
  console.log(formatSnapshot("before", preview.before));
  console.log(formatSnapshot("after ", preview.after));
  console.log(`wouldChange=${preview.wouldChange}`);
  console.log(`parsedInvoiceNumber=${preview.parsedInvoiceNumber ?? "null"}`);

  if (!preview.wouldChange) {
    console.log("\nno change needed, skipping");
    console.log(`updated=false`);
    console.log(formatSnapshot("final after", preview.after));
    return;
  }

  console.log("\nAPPLYING UPDATE...");
  const applied = await reprocessFinancialDocumentBySource({
    ...baseParams,
    dryRun: false,
  });

  console.log(`\n--- Result ---`);
  console.log(`updated=${applied.updated}`);
  console.log(`source=${applied.sourceTable} id=${applied.sourceId}`);
  console.log(formatSnapshot("final after", applied.after));
}

main()
  .catch((err) => {
    console.error("[reprocess-one-apply] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
