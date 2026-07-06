/**
 * Domain 2 read-only production snapshot — aggregates only, no PII.
 */
import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env.prod.local") });

const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL } },
});

async function q(sql, ...params) {
  return prisma.$queryRawUnsafe(sql, ...params);
}

const snapshot = {};

// Table totals
for (const table of [
  "FinancialDocumentReview",
  "SupplierPayment",
  "Invoice",
  "GmailScanItem",
  "WhatsAppLog",
  "CommunicationEvent",
  "Lead",
  "Client",
  "Task",
  "Appointment",
  "Integration",
  "EmailMessage",
]) {
  const row = await q(`SELECT COUNT(*)::int AS cnt FROM "${table}"`);
  snapshot[`total_${table}`] = row[0]?.cnt ?? 0;
}

// Pilot org totals
for (const table of [
  "FinancialDocumentReview",
  "SupplierPayment",
  "GmailScanItem",
  "WhatsAppLog",
  "CommunicationEvent",
  "Lead",
]) {
  const row = await q(`SELECT COUNT(*)::int AS cnt FROM "${table}" WHERE "organizationId" = $1`, PILOT);
  snapshot[`pilot_${table}`] = row[0]?.cnt ?? 0;
}

// Duplicate fingerprints (FDR)
snapshot.fdr_duplicate_fingerprint_groups = (
  await q(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId", "documentFingerprint"
      FROM "FinancialDocumentReview"
      WHERE "documentFingerprint" IS NOT NULL AND "documentFingerprint" <> ''
      GROUP BY "organizationId", "documentFingerprint"
      HAVING COUNT(*) > 1
    ) t
  `)
)[0]?.groups;

// Duplicate fingerprints (SupplierPayment)
snapshot.payment_duplicate_fingerprint_groups = (
  await q(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId", "documentFingerprint"
      FROM "SupplierPayment"
      WHERE "documentFingerprint" IS NOT NULL AND "documentFingerprint" <> ''
      GROUP BY "organizationId", "documentFingerprint"
      HAVING COUNT(*) > 1
    ) t
  `)
)[0]?.groups;

snapshot.payment_duplicate_hash_groups = (
  await q(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId", "duplicateHash"
      FROM "SupplierPayment"
      WHERE "duplicateHash" IS NOT NULL AND "duplicateHash" <> ''
      GROUP BY "organizationId", "duplicateHash"
      HAVING COUNT(*) > 1
    ) t
  `)
)[0]?.groups;

// Cross-org gmailMessageId
snapshot.cross_org_gmail_message_ids = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT "gmailMessageId" FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId" HAVING COUNT(DISTINCT "organizationId") > 1
    ) t
  `)
)[0]?.cnt;

// WhatsApp duplicate providerMessageSid (inbound)
snapshot.whatsapp_duplicate_sid_groups = (
  await q(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId", "providerMessageSid"
      FROM "WhatsAppLog"
      WHERE direction = 'inbound' AND "providerMessageSid" IS NOT NULL AND "providerMessageSid" <> '' AND "providerMessageSid" <> 'unknown'
      GROUP BY "organizationId", "providerMessageSid"
      HAVING COUNT(*) > 1
    ) t
  `)
)[0]?.groups;

// Zero/null amounts
snapshot.payments_zero_amount = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "SupplierPayment" WHERE amount = 0 OR amount IS NULL`)
)[0]?.cnt;
snapshot.payments_null_total_amount = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "SupplierPayment" WHERE "totalAmount" IS NULL`)
)[0]?.cnt;
snapshot.fdr_null_total_amount = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview" WHERE "totalAmount" IS NULL`)
)[0]?.cnt;
snapshot.fdr_zero_total_amount = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview" WHERE "totalAmount" = 0`)
)[0]?.cnt;

// Null supplier
snapshot.fdr_null_supplier = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview" WHERE "supplierName" IS NULL OR TRIM("supplierName") = ''`)
)[0]?.cnt;
snapshot.payments_null_supplier = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "SupplierPayment" WHERE "supplierName" IS NULL OR TRIM("supplierName") = ''`)
)[0]?.cnt;

// Status inconsistencies
snapshot.fdr_needs_review_with_payment = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview"
    WHERE "reviewStatus" = 'needs_review' AND "supplierPaymentId" IS NOT NULL
  `)
)[0]?.cnt;
snapshot.fdr_approved_no_payment = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview"
    WHERE "reviewStatus" = 'approved' AND "supplierPaymentId" IS NULL
  `)
)[0]?.cnt;
snapshot.gsi_approved_no_payment = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "GmailScanItem" gsi
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
  `)
)[0]?.cnt;
snapshot.payment_approved_fdr_rejected = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview" fdr
    INNER JOIN "SupplierPayment" sp ON sp.id = fdr."supplierPaymentId"
    WHERE fdr."reviewStatus" = 'rejected' AND sp."approvalStatus" = 'approved'
  `)
)[0]?.cnt;

// Orphans
snapshot.fdr_no_source_link = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview"
    WHERE "gmailMessageId" IS NULL AND "emailMessageId" IS NULL AND "whatsappLogId" IS NULL
  `)
)[0]?.cnt;
snapshot.fdr_whatsapp_log_missing = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview" fdr
    WHERE fdr."whatsappLogId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "WhatsAppLog" w WHERE w.id = fdr."whatsappLogId")
  `)
)[0]?.cnt;
snapshot.payment_orphan_fdr_link = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "FinancialDocumentReview" fdr
    WHERE fdr."supplierPaymentId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "SupplierPayment" sp WHERE sp.id = fdr."supplierPaymentId")
  `)
)[0]?.cnt;
snapshot.whatsapp_inbound_no_comm_event = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "WhatsAppLog" w
    WHERE w.direction = 'inbound' AND w."providerMessageSid" IS NOT NULL AND w."providerMessageSid" <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "CommunicationEvent" ce
        WHERE ce."organizationId" = w."organizationId"
          AND ce.channel = 'whatsapp'
          AND ce."externalMessageId" = w."providerMessageSid"
      )
  `)
)[0]?.cnt;
snapshot.tasks_no_org = (await q(`SELECT COUNT(*)::int AS cnt FROM "Task" WHERE "organizationId" IS NULL`))[0]?.cnt;
snapshot.appointments_no_client = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "Appointment" WHERE "clientId" IS NULL`)
)[0]?.cnt;

// Stuck scans
snapshot.scans_stuck_running = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "SyncLog"
    WHERE status IN ('running', 'queued') AND "startedAt" < NOW() - INTERVAL '2 hours'
  `)
)[0]?.cnt;

// Amount mismatch amount vs totalAmount on payments
snapshot.payments_amount_total_mismatch = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "SupplierPayment"
    WHERE "totalAmount" IS NOT NULL AND amount IS NOT NULL AND ABS(amount - "totalAmount") > 0.01
  `)
)[0]?.cnt;

// Lead duplicates (same phone in org)
snapshot.lead_duplicate_phone_groups = (
  await q(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId", phone FROM "Lead"
      WHERE phone IS NOT NULL AND TRIM(phone) <> ''
      GROUP BY "organizationId", phone HAVING COUNT(*) > 1
    ) t
  `)
)[0]?.groups;

// Client duplicate email in org
snapshot.client_duplicate_email_groups = (
  await q(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId", email FROM "Client"
      WHERE email IS NOT NULL AND TRIM(email) <> ''
      GROUP BY "organizationId", email HAVING COUNT(*) > 1
    ) t
  `)
)[0]?.groups;

// Appointment same client+start (possible dup)
snapshot.appointment_same_client_start_groups = (
  await q(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId", "clientId", "startTime"
      FROM "Appointment"
      WHERE status <> 'cancelled' AND "clientId" IS NOT NULL
      GROUP BY "organizationId", "clientId", "startTime"
      HAVING COUNT(*) > 1
    ) t
  `)
)[0]?.groups;

// Comm event org mismatch with whatsapp log (if linkable via sid)
snapshot.comm_whatsapp_org_mismatch = (
  await q(`
    SELECT COUNT(*)::int AS cnt FROM "CommunicationEvent" ce
    INNER JOIN "WhatsAppLog" w
      ON w."providerMessageSid" = ce."externalMessageId"
      AND w.direction = 'inbound'
    WHERE ce.channel = 'whatsapp' AND ce."organizationId" <> w."organizationId"
  `)
)[0]?.cnt;

// Gmail/WhatsApp same fingerprint both channels in pilot
snapshot.pilot_cross_channel_fingerprint_groups = (
  await q(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "documentFingerprint"
      FROM "FinancialDocumentReview"
      WHERE "organizationId" = $1 AND "documentFingerprint" IS NOT NULL
      GROUP BY "documentFingerprint"
      HAVING COUNT(DISTINCT source) > 1
    ) t
  `, PILOT)
)[0]?.groups;

// Integration without org (should be 0)
snapshot.integrations_no_org = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "Integration" WHERE "organizationId" IS NULL`)
)[0]?.cnt;

// Nullable fingerprint payments (dedup gap)
snapshot.payments_null_document_fingerprint = (
  await q(`SELECT COUNT(*)::int AS cnt FROM "SupplierPayment" WHERE "documentFingerprint" IS NULL OR "documentFingerprint" = ''`)
)[0]?.cnt;

console.log(JSON.stringify({ exportedAt: new Date().toISOString(), pilotOrg: PILOT, snapshot }, null, 2));

await prisma.$disconnect();
