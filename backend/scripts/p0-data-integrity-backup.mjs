/**
 * Phase A — read-only export of affected row IDs/metadata (no PII).
 * Output: backend/data/p0-integrity-backup/<timestamp>/
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env") });
config({ path: join(process.cwd(), ".env.prod.local"), override: false });

const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const SHARON_ORG = "cmqxujfuj034ndy2czu9tjoko";
const ALLOWLIST_IDS = [
  "19eac05f383d017b",
  "19f1c987ae04f50b",
  "19ed3a45ad6c0c41",
  "19ed4213bdd6e726",
  "19ebfbbfb5c8e626",
];

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeJson(dir, name, data) {
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2), "utf8");
}

async function contaminatedGmailIds() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "gmailMessageId" AS gmail_id
    FROM "GmailScanItem"
    WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
    GROUP BY "gmailMessageId"
    HAVING COUNT(DISTINCT "organizationId") > 1
  `);
  return rows.map((r) => r.gmail_id);
}

function allowlistSqlIn() {
  return ALLOWLIST_IDS.map((id) => `'${id}'`).join(", ");
}

async function main() {
  const outDir = join(process.cwd(), "data", "p0-integrity-backup", stamp());
  mkdirSync(outDir, { recursive: true });

  const gmailIds = await contaminatedGmailIds();
  const gmailIn =
    gmailIds.length > 0 ? gmailIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ") : "''";

  const contaminatedGsi = await prisma.$queryRawUnsafe(`
    SELECT id, "organizationId", "gmailMessageId", "reviewStatus", "createdAt"
    FROM "GmailScanItem"
    WHERE "gmailMessageId" IN (${gmailIn})
      AND NOT ("organizationId" = '${SHARON_ORG}' AND "gmailMessageId" IN (${allowlistSqlIn()}))
    ORDER BY "organizationId", id
  `);

  const contaminatedEmails = await prisma.$queryRawUnsafe(`
    SELECT id, "organizationId", "gmailId", "processedAt", "createdAt"
    FROM "EmailMessage"
    WHERE "gmailId" IN (${gmailIn})
    ORDER BY "organizationId", id
  `);

  const contaminatedFdr = await prisma.$queryRawUnsafe(`
    SELECT id, "organizationId", "gmailMessageId", "reviewStatus", "supplierPaymentId", "createdAt"
    FROM "FinancialDocumentReview"
    WHERE "gmailMessageId" IN (${gmailIn})
    ORDER BY "organizationId", id
  `);

  const zeroPayments = await prisma.$queryRawUnsafe(`
    SELECT id, "organizationId", "approvalStatus", amount, "documentFingerprint", "createdAt"
    FROM "SupplierPayment"
    WHERE amount IS NULL OR amount <= 0
    ORDER BY "organizationId", id
  `);

  const fdrMismatch = await prisma.$queryRawUnsafe(`
    SELECT fdr.id, fdr."organizationId", fdr."reviewStatus", fdr."supplierPaymentId",
           sp."approvalStatus" AS payment_status, sp.amount AS payment_amount
    FROM "FinancialDocumentReview" fdr
    INNER JOIN "SupplierPayment" sp ON sp.id = fdr."supplierPaymentId"
    WHERE fdr."reviewStatus" = 'needs_review'
    ORDER BY fdr."organizationId", fdr.id
  `);

  const gsiApprovedNoPayment = await prisma.$queryRawUnsafe(`
    SELECT gsi.id, gsi."organizationId", gsi."gmailMessageId", gsi."reviewStatus", gsi."duplicateKey"
    FROM "GmailScanItem" gsi
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
  `);

  const whatsappDupGroups = await prisma.$queryRawUnsafe(`
    SELECT "organizationId", "providerMessageSid", COUNT(*)::int AS cnt
    FROM "WhatsAppLog"
    WHERE direction = 'inbound'
      AND "providerMessageSid" IS NOT NULL
      AND "providerMessageSid" <> ''
      AND "providerMessageSid" <> 'unknown'
    GROUP BY "organizationId", "providerMessageSid"
    HAVING COUNT(*) > 1
  `);

  const whatsappInboundKeys = await prisma.$queryRawUnsafe(`
    SELECT id, "organizationId", direction, "providerMessageSid", "createdAt"
    FROM "WhatsAppLog"
    WHERE direction = 'inbound'
      AND "providerMessageSid" IS NOT NULL
      AND "providerMessageSid" <> ''
    ORDER BY "organizationId", "providerMessageSid", "createdAt"
  `);

  const nullFingerprintPayments = await prisma.$queryRawUnsafe(`
    SELECT id, "organizationId", "approvalStatus", amount, "createdAt"
    FROM "SupplierPayment"
    WHERE "documentFingerprint" IS NULL OR TRIM("documentFingerprint") = ''
    ORDER BY "organizationId", id
  `);

  const pilotFilter = (rows) => rows.filter((r) => r.organizationId === PILOT);

  const aggregates = {
    exportedAt: new Date().toISOString(),
    pilotOrgId: PILOT,
    global: {
      crossOrgGmailIds: gmailIds.length,
      contaminatedGsi: contaminatedGsi.length,
      contaminatedEmails: contaminatedEmails.length,
      contaminatedFdr: contaminatedFdr.length,
      zeroPayments: zeroPayments.length,
      fdrMismatch: fdrMismatch.length,
      gsiApprovedNoPayment: gsiApprovedNoPayment.length,
      whatsappDuplicateGroups: whatsappDupGroups.length,
      nullFingerprintPayments: nullFingerprintPayments.length,
    },
    pilot: {
      contaminatedGsi: pilotFilter(contaminatedGsi).length,
      contaminatedEmails: pilotFilter(contaminatedEmails).length,
      contaminatedFdr: pilotFilter(contaminatedFdr).length,
      zeroPayments: pilotFilter(zeroPayments).length,
      fdrMismatch: pilotFilter(fdrMismatch).length,
      gsiApprovedNoPayment: pilotFilter(gsiApprovedNoPayment).length,
      nullFingerprintPayments: pilotFilter(nullFingerprintPayments).length,
    },
  };

  const remediationPlan = {
    quarantine: {
      description: "Mark cross-org contaminated GSI/FDR rejected; flag linked payments",
      gsiRows: "contaminated_gsi.json ids where reviewStatus not already rejected with quarantine marker",
      fdrRows: "contaminated_fdr.json",
      untouched: "Sharon allowlist GSI rows (5 gmailMessageIds)",
    },
    zeroAmountPayments: {
      description: "Set approvalStatus=needs_review, append data_quality_issue:zero_amount marker",
      pilotFirst: true,
      rows: "zero_payments.json where amount<=0",
    },
    fdrPaymentMismatch: {
      description: "If payment approved with amount>0, set FDR approved; else leave needs_review",
      pilotFirst: true,
      rows: "fdr_mismatch.json",
    },
    gsiApprovedNoPayment: {
      description: "Revert reviewStatus to needs_review with data_quality_issue marker",
      rows: "gsi_approved_no_payment.json",
    },
    whatsappUnique: {
      blocked: whatsappDupGroups.length > 0,
      description:
        whatsappDupGroups.length > 0
          ? "STOP — resolve duplicate SID groups before migration"
          : "Safe to add partial unique index on organizationId+providerMessageSid (inbound)",
    },
    documentFingerprint: {
      description: "App-level enforcement for new rows; legacy nulls flagged by validator only",
      rows: "null_fingerprint_payments.json (legacy, no column NOT NULL yet)",
    },
    rollback: {
      note: "Restore from JSON snapshots in this directory; re-apply prior column values per entity file",
      gsi: "UPDATE GmailScanItem SET reviewStatus=?, decisionReason=? WHERE id=?",
      fdr: "UPDATE FinancialDocumentReview SET reviewStatus=?, uncertaintyReason=? WHERE id=?",
      payment: "UPDATE SupplierPayment SET approvalStatus=?, duplicateDetected=?, duplicateReason=? WHERE id=?",
    },
  };

  writeJson(outDir, "aggregates.json", aggregates);
  writeJson(outDir, "remediation_plan.json", remediationPlan);
  writeJson(outDir, "contaminated_gsi.json", contaminatedGsi);
  writeJson(outDir, "contaminated_emails.json", contaminatedEmails);
  writeJson(outDir, "contaminated_fdr.json", contaminatedFdr);
  writeJson(outDir, "zero_payments.json", zeroPayments);
  writeJson(outDir, "fdr_mismatch.json", fdrMismatch);
  writeJson(outDir, "gsi_approved_no_payment.json", gsiApprovedNoPayment);
  writeJson(outDir, "whatsapp_duplicate_groups.json", whatsappDupGroups);
  writeJson(outDir, "whatsapp_inbound_keys.json", whatsappInboundKeys);
  writeJson(outDir, "null_fingerprint_payments.json", nullFingerprintPayments);

  console.log(JSON.stringify({ ok: true, backupDir: outDir, aggregates }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
