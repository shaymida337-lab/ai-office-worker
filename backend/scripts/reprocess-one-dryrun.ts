/**
 * DRY-RUN only — never writes to DB (dryRun: true is hardcoded).
 * Run: cd backend && npx tsx scripts/reprocess-one-dryrun.ts <recordId> [organizationId]
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
    console.error("Usage: npx tsx scripts/reprocess-one-dryrun.ts <recordId> [organizationId]");
    process.exit(1);
  }

  const sourceParams = reprocessParamsFromRecordId(recordId);
  const sourceKind = sourceParams.financialDocumentReviewId
    ? "FinancialDocumentReview"
    : sourceParams.invoiceId
      ? "Invoice"
      : "GmailScanItem";

  let organizationId = await resolveOrganizationId(recordId, sourceParams, process.argv[3]?.trim());
  if (!organizationId) {
    console.error("organizationId is required (argv[3], ORGANIZATION_ID env, or resolvable from recordId)");
    process.exit(1);
  }

  console.log(`=== Reprocess DRY-RUN (read-only) ===`);
  console.log(`recordId=${recordId} sourceKind=${sourceKind} organizationId=${organizationId}\n`);

  const result = await reprocessFinancialDocumentBySource({
    organizationId,
    ...sourceParams,
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
