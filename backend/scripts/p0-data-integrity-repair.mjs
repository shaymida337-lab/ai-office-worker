/**
 * P0 data integrity repair — pilot-first by default.
 * Dry-run (default): BEGIN … ROLLBACK
 * Execute: --execute
 * Scope: --scope=pilot (default) | --scope=global
 */
import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env") });
config({ path: join(process.cwd(), ".env.prod.local"), override: false });

const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const SHARON_ORG = "cmqxujfuj034ndy2czu9tjoko";
const QUARANTINE = "Quarantined: cross-org gmail ingestion";
const ZERO_MARKER = "data_quality_issue:zero_amount";
const GSI_MARKER = "data_quality_issue:approved_without_payment";

const execute = process.argv.includes("--execute");
const scopeArg = process.argv.find((a) => a.startsWith("--scope="));
const scope = scopeArg?.split("=")[1] ?? "pilot";
const orgFilter = scope === "global" ? "" : `AND t."organizationId" = '${PILOT}'`;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

async function countDuplicates() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId", "providerMessageSid"
      FROM "WhatsAppLog"
      WHERE direction = 'inbound'
        AND "providerMessageSid" IS NOT NULL
        AND "providerMessageSid" <> ''
        AND "providerMessageSid" <> 'unknown'
      GROUP BY "organizationId", "providerMessageSid"
      HAVING COUNT(*) > 1
    ) t
  `);
  return rows[0]?.groups ?? 0;
}

async function repairCrossOrg(tx) {
  const gsi = await tx.$executeRawUnsafe(`
    UPDATE "GmailScanItem" gsi
    SET
      "reviewStatus" = 'rejected',
      "decisionReason" = CASE
        WHEN COALESCE(gsi."decisionReason", '') LIKE '%${QUARANTINE}%' THEN gsi."decisionReason"
        WHEN COALESCE(gsi."decisionReason", '') = '' THEN '${QUARANTINE}'
        ELSE gsi."decisionReason" || '; ${QUARANTINE}'
      END,
      "updatedAt" = NOW()
    FROM (
      SELECT "gmailMessageId" AS gmail_id
      FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId"
      HAVING COUNT(DISTINCT "organizationId") > 1
    ) contaminated
    WHERE gsi."gmailMessageId" = contaminated.gmail_id
      AND NOT (gsi."organizationId" = '${SHARON_ORG}' AND gsi."gmailMessageId" IN (
        '19eac05f383d017b','19f1c987ae04f50b','19ed3a45ad6c0c41','19ed4213bdd6e726','19ebfbbfb5c8e626'
      ))
      AND (gsi."reviewStatus" <> 'rejected' OR COALESCE(gsi."decisionReason", '') NOT LIKE '%${QUARANTINE}%')
      ${orgFilter.replaceAll("t.", "gsi.")}
  `);

  const fdr = await tx.$executeRawUnsafe(`
    UPDATE "FinancialDocumentReview" fdr
    SET
      "reviewStatus" = 'rejected',
      "uncertaintyReason" = CASE
        WHEN COALESCE(fdr."uncertaintyReason", '') LIKE '%${QUARANTINE}%' THEN fdr."uncertaintyReason"
        WHEN COALESCE(fdr."uncertaintyReason", '') = '' THEN '${QUARANTINE}'
        ELSE fdr."uncertaintyReason" || '; ${QUARANTINE}'
      END,
      "updatedAt" = NOW()
    FROM (
      SELECT "gmailMessageId" AS gmail_id
      FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId"
      HAVING COUNT(DISTINCT "organizationId") > 1
    ) contaminated
    WHERE fdr."gmailMessageId" = contaminated.gmail_id
      AND NOT (fdr."organizationId" = '${SHARON_ORG}' AND fdr."gmailMessageId" IN (
        '19eac05f383d017b','19f1c987ae04f50b','19ed3a45ad6c0c41','19ed4213bdd6e726','19ebfbbfb5c8e626'
      ))
      AND (fdr."reviewStatus" <> 'rejected' OR COALESCE(fdr."uncertaintyReason", '') NOT LIKE '%${QUARANTINE}%')
      ${orgFilter.replaceAll("t.", "fdr.")}
  `);

  const payments = await tx.$executeRawUnsafe(`
    UPDATE "SupplierPayment" sp
    SET
      "approvalStatus" = CASE WHEN sp."approvalStatus" = 'approved' THEN 'needs_review' ELSE sp."approvalStatus" END,
      "duplicateDetected" = true,
      "duplicateReason" = CASE
        WHEN COALESCE(sp."duplicateReason", '') LIKE '%${QUARANTINE}%' THEN sp."duplicateReason"
        WHEN COALESCE(sp."duplicateReason", '') = '' THEN '${QUARANTINE}'
        ELSE sp."duplicateReason" || '; ${QUARANTINE}'
      END,
      "updatedAt" = NOW()
    WHERE sp."emailMessageId" IN (
      SELECT em.id FROM "EmailMessage" em
      INNER JOIN (
        SELECT "gmailMessageId" AS gmail_id
        FROM "GmailScanItem"
        WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
        GROUP BY "gmailMessageId"
        HAVING COUNT(DISTINCT "organizationId") > 1
      ) contaminated ON em."gmailId" = contaminated.gmail_id
      ${orgFilter.replaceAll("t.", "em.")}
    )
    AND COALESCE(sp."duplicateReason", '') NOT LIKE '%${QUARANTINE}%'
    ${orgFilter.replaceAll("t.", "sp.")}
  `);

  return { gsi, fdr, payments };
}

async function repairZeroAmount(tx) {
  return tx.$executeRawUnsafe(`
    UPDATE "SupplierPayment" sp
    SET
      "approvalStatus" = CASE WHEN sp."approvalStatus" = 'approved' THEN 'needs_review' ELSE sp."approvalStatus" END,
      "duplicateDetected" = true,
      "duplicateReason" = CASE
        WHEN COALESCE(sp."duplicateReason", '') LIKE '%${ZERO_MARKER}%' THEN sp."duplicateReason"
        WHEN COALESCE(sp."duplicateReason", '') = '' THEN '${ZERO_MARKER}'
        ELSE sp."duplicateReason" || '; ${ZERO_MARKER}'
      END,
      "updatedAt" = NOW()
    WHERE (sp.amount IS NULL OR sp.amount <= 0)
      AND COALESCE(sp."duplicateReason", '') NOT LIKE '%${ZERO_MARKER}%'
      ${orgFilter.replaceAll("t.", "sp.")}
  `);
}

async function repairFdrMismatch(tx) {
  const approved = await tx.$executeRawUnsafe(`
    UPDATE "FinancialDocumentReview" fdr
    SET "reviewStatus" = 'approved', "updatedAt" = NOW()
    FROM "SupplierPayment" sp
    WHERE fdr."supplierPaymentId" = sp.id
      AND fdr."reviewStatus" = 'needs_review'
      AND sp."approvalStatus" = 'approved'
      AND sp.amount > 0
      ${orgFilter.replaceAll("t.", "fdr.")}
  `);

  const detachInvalid = await tx.$executeRawUnsafe(`
    UPDATE "FinancialDocumentReview" fdr
    SET
      "supplierPaymentId" = NULL,
      "uncertaintyReason" = CASE
        WHEN COALESCE(fdr."uncertaintyReason", '') LIKE '%data_quality_issue:fdr_payment_mismatch%' THEN fdr."uncertaintyReason"
        WHEN COALESCE(fdr."uncertaintyReason", '') = '' THEN 'data_quality_issue:fdr_payment_mismatch'
        ELSE fdr."uncertaintyReason" || '; data_quality_issue:fdr_payment_mismatch'
      END,
      "updatedAt" = NOW()
    FROM "SupplierPayment" sp
    WHERE fdr."supplierPaymentId" = sp.id
      AND fdr."reviewStatus" = 'needs_review'
      AND (sp."approvalStatus" = 'rejected' OR sp.amount IS NULL OR sp.amount <= 0)
      ${orgFilter.replaceAll("t.", "fdr.")}
  `);

  return { approved, detachInvalid };
}

async function repairGsiApprovedNoPayment(tx) {
  return tx.$executeRawUnsafe(`
    UPDATE "GmailScanItem" gsi
    SET
      "reviewStatus" = 'needs_review',
      "decisionReason" = CASE
        WHEN COALESCE(gsi."decisionReason", '') LIKE '%${GSI_MARKER}%' THEN gsi."decisionReason"
        WHEN COALESCE(gsi."decisionReason", '') = '' THEN '${GSI_MARKER}'
        ELSE gsi."decisionReason" || '; ${GSI_MARKER}'
      END,
      "updatedAt" = NOW()
    WHERE gsi."reviewStatus" = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM "SupplierPayment" sp
        WHERE sp."organizationId" = gsi."organizationId"
          AND (sp."duplicateHash" = gsi."duplicateKey" OR sp."documentFingerprint" = gsi."duplicateKey")
      )
      AND NOT EXISTS (
        SELECT 1 FROM "FinancialDocumentReview" fdr
        WHERE fdr."organizationId" = gsi."organizationId"
          AND fdr."gmailMessageId" = gsi."gmailMessageId"
          AND fdr."supplierPaymentId" IS NOT NULL
      )
      ${orgFilter.replaceAll("t.", "gsi.")}
  `);
}

async function snapshotCounts() {
  const row = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM "SupplierPayment" WHERE amount <= 0 ${orgFilter.replaceAll("t.", "")}) AS zero_payments,
      (SELECT COUNT(*)::int FROM "FinancialDocumentReview" fdr
        WHERE fdr."reviewStatus" = 'needs_review' AND fdr."supplierPaymentId" IS NOT NULL
        ${orgFilter.replaceAll("t.", "fdr.")}) AS fdr_mismatch,
      (SELECT COUNT(*)::int FROM "GmailScanItem" gsi
        WHERE gsi."reviewStatus" = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM "SupplierPayment" sp
            WHERE sp."organizationId" = gsi."organizationId"
              AND (sp."duplicateHash" = gsi."duplicateKey" OR sp."documentFingerprint" = gsi."duplicateKey")
          )
        ${orgFilter.replaceAll("t.", "gsi.")}) AS gsi_approved_no_payment
  `);
  return row[0];
}

async function main() {
  const dupGroups = await countDuplicates();
  if (dupGroups > 0) {
    console.error(JSON.stringify({ ok: false, error: "WhatsApp duplicate SID groups exist", dupGroups }));
    process.exit(2);
  }

  const before = await snapshotCounts();
  await prisma.$executeRawUnsafe("BEGIN");
  try {
    const fdr = await repairFdrMismatch(prisma);
    const zero = await repairZeroAmount(prisma);
    const crossOrg = await repairCrossOrg(prisma);
    const gsi = await repairGsiApprovedNoPayment(prisma);
    const after = await snapshotCounts();

    if (execute) {
      await prisma.$executeRawUnsafe("COMMIT");
    } else {
      await prisma.$executeRawUnsafe("ROLLBACK");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: execute ? "execute" : "dry-run",
          scope,
          before,
          updates: { fdr, zero, crossOrg, gsi },
          after: execute ? after : before,
          note: execute ? "committed" : "rolled back — pass --execute to commit",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    await prisma.$executeRawUnsafe("ROLLBACK");
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
