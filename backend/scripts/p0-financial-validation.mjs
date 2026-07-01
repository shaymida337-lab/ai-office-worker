/**
 * P0-001/P0-002 validation: cross-org contamination + foreign financial rows.
 * SELECT-only.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const organizationId = process.argv[2] ?? "cmqxujfuj034ndy2czu9tjoko";
const ALLOWLIST = [
  "19eac05f383d017b",
  "19f1c987ae04f50b",
  "19ed3a45ad6c0c41",
  "19ed4213bdd6e726",
  "19ebfbbfb5c8e626",
];

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  const crossOrgGmailIds = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT "gmailMessageId" FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId" HAVING COUNT(DISTINCT "organizationId") > 1
    ) t
  `);

  const activeForeignFdr = await prisma.$queryRawUnsafe(
    `
    SELECT COUNT(*)::int AS cnt
    FROM "FinancialDocumentReview" f
    INNER JOIN (
      SELECT "gmailMessageId" AS gmail_id
      FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId"
      HAVING COUNT(DISTINCT "organizationId") > 1
    ) c ON c.gmail_id = f."gmailMessageId"
    WHERE f."organizationId" = $1
      AND f."reviewStatus" NOT IN ('rejected')
      AND f."gmailMessageId" <> ALL($2::text[])
      AND COALESCE(f."uncertaintyReason", '') NOT LIKE '%Quarantined: cross-org gmail ingestion%'
  `,
    organizationId,
    ALLOWLIST
  );

  const duplicatePayments = await prisma.$queryRawUnsafe(
    `
    SELECT COUNT(*)::int AS groups FROM (
      SELECT sp."organizationId", e."gmailId"
      FROM "SupplierPayment" sp
      INNER JOIN "EmailMessage" e ON e.id = sp."emailMessageId"
      WHERE (sp."approvalStatus" = 'approved' OR sp.paid = true)
        AND sp."duplicateDetected" = false
        AND e."gmailId" <> ALL($1::text[])
      GROUP BY sp."organizationId", e."gmailId"
      HAVING COUNT(*) > 1
    ) t
  `,
    ALLOWLIST
  );

  const report = {
    exportedAt: new Date().toISOString(),
    organizationId,
    crossOrgGmailIds: crossOrgGmailIds[0]?.cnt ?? 0,
    activeForeignFinancialReviews: activeForeignFdr[0]?.cnt ?? 0,
    duplicateSupplierPaymentGroups: duplicatePayments[0]?.groups ?? 0,
    p0Pass:
      (activeForeignFdr[0]?.cnt ?? 0) === 0 &&
      (duplicatePayments[0]?.groups ?? 0) === 0,
    note: "Run scripts/gmail-isolation-audit.mjs separately for shared refresh-token groups.",
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(report.p0Pass ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
