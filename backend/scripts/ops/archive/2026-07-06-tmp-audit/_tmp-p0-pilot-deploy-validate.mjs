/**
 * Pilot P0 post-deploy validation — aggregates only, no PII.
 */
import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

config({ path: join(process.cwd(), ".env.prod.local") });

const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const TARGET_COMMIT = "5f797bd";
const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL } },
});

async function fetchRenderEnvMap() {
  const headers = { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json" };
  const map = {};
  let cursor = null;
  do {
    const url = new URL(`https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/env-vars`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetch(url, { headers }).then((r) => r.json());
    for (const item of data) {
      const ev = item.envVar ?? item;
      if (ev?.key) map[ev.key] = ev.value ?? "";
    }
    cursor = data.at(-1)?.cursor ?? null;
  } while (cursor);
  return map;
}

async function main() {
  const renderEnv = await fetchRenderEnvMap();
  const jwtSecret = renderEnv.JWT_SECRET;

  const health = await fetch(`${apiBase}/health`).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));

  const migrationRows = await prisma.$queryRawUnsafe(`
    SELECT migration_name, finished_at
    FROM _prisma_migrations
    WHERE migration_name LIKE '%whatsapp_inbound%'
    ORDER BY finished_at DESC
    LIMIT 3
  `);
  const uniqueIndex = await prisma.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes
    WHERE indexname = 'WhatsAppLog_org_inbound_providerMessageSid_key'
  `);

  const pilotOrg = await prisma.organization.findUnique({
    where: { id: PILOT },
    include: { user: true },
  });
  const ownerToken = jwt.sign(
    { userId: pilotOrg.user.id, organizationId: PILOT, email: pilotOrg.user.email },
    jwtSecret,
    { expiresIn: "1h" },
  );

  const dashboardRes = await fetch(`${apiBase}/api/dashboard`, {
    headers: { Authorization: `Bearer ${ownerToken}`, Accept: "application/json" },
  });
  const dashboard = dashboardRes.ok ? await dashboardRes.json() : { error: dashboardRes.status };

  const waSummaryRes = await fetch(`${apiBase}/api/whatsapp-assistant/stats`, {
    headers: { Authorization: `Bearer ${ownerToken}`, Accept: "application/json" },
  });
  const waSummary = waSummaryRes.ok ? await waSummaryRes.json() : { error: waSummaryRes.status };

  const counts = (
    await prisma.$queryRawUnsafe(
      `
    SELECT
      (SELECT COUNT(*)::int FROM "SupplierPayment"
        WHERE "organizationId" = $1 AND (amount IS NULL OR amount <= 0)
          AND COALESCE("duplicateReason", '') NOT LIKE '%data_quality_issue:zero_amount%') AS zero_unmarked,
      (SELECT COUNT(*)::int FROM "SupplierPayment"
        WHERE "organizationId" = $1 AND (amount IS NULL OR amount <= 0)
          AND COALESCE("duplicateReason", '') LIKE '%data_quality_issue:zero_amount%') AS zero_marked,
      (SELECT COUNT(*)::int FROM "FinancialDocumentReview" fdr
        INNER JOIN "SupplierPayment" sp ON sp.id = fdr."supplierPaymentId"
        WHERE fdr."organizationId" = $1 AND fdr."reviewStatus" = 'needs_review'
          AND sp."approvalStatus" = 'approved' AND sp.amount > 0) AS fdr_mismatch_approved,
      (SELECT COUNT(*)::int FROM "GmailScanItem" gsi
        WHERE gsi."organizationId" = $1
          AND gsi."gmailMessageId" IN (
            SELECT "gmailMessageId" FROM "GmailScanItem"
            WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
            GROUP BY "gmailMessageId" HAVING COUNT(DISTINCT "organizationId") > 1
          )
          AND gsi."reviewStatus" <> 'rejected') AS contaminated_gsi_active,
      (SELECT COUNT(*)::int FROM "GmailScanItem" gsi
        WHERE gsi."organizationId" = $1
          AND gsi."gmailMessageId" IN (
            SELECT "gmailMessageId" FROM "GmailScanItem"
            WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
            GROUP BY "gmailMessageId" HAVING COUNT(DISTINCT "organizationId") > 1
          )
          AND gsi."reviewStatus" = 'rejected'
          AND COALESCE(gsi."decisionReason", '') LIKE '%Quarantined: cross-org%') AS contaminated_gsi_quarantined,
      (SELECT COUNT(*)::int FROM "GmailScanItem" gsi
        WHERE gsi."organizationId" = $1 AND gsi."reviewStatus" = 'approved'
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
          )) AS gsi_approved_no_payment,
      (SELECT COUNT(*)::int FROM (
        SELECT "organizationId", "providerMessageSid"
        FROM "WhatsAppLog"
        WHERE "organizationId" = $1 AND direction = 'inbound'
          AND "providerMessageSid" IS NOT NULL AND "providerMessageSid" <> ''
        GROUP BY "organizationId", "providerMessageSid" HAVING COUNT(*) > 1
      ) t) AS whatsapp_dup_groups
  `,
      PILOT,
    )
  )[0];

  let whatsappUniqueWorks = false;
  let whatsappUniqueDetail = null;
  const testSid = `SM-p0-pilot-validate-${Date.now()}`;
  try {
    await prisma.whatsAppLog.create({
      data: {
        organizationId: PILOT,
        direction: "inbound",
        body: "p0-unique-test",
        providerMessageSid: testSid,
        fromNumber: "test",
        toNumber: "test",
      },
      select: { id: true },
    });
    let dupBlocked = false;
    try {
      await prisma.whatsAppLog.create({
        data: {
          organizationId: PILOT,
          direction: "inbound",
          body: "p0-unique-test-dup",
          providerMessageSid: testSid,
          fromNumber: "test",
          toNumber: "test",
        },
      });
    } catch (err) {
      dupBlocked = err?.code === "P2002";
      whatsappUniqueDetail = { code: err?.code ?? null };
    }
    whatsappUniqueWorks = dupBlocked;
    await prisma.whatsAppLog.deleteMany({ where: { organizationId: PILOT, providerMessageSid: testSid } });
  } catch (err) {
    whatsappUniqueDetail = { setupError: err?.code ?? err?.message };
  }

  const { assertNewSupplierPaymentQuality } = await import("../src/services/p0/supplierPaymentQuality.ts");
  let fingerprintGuardWorks = false;
  try {
    assertNewSupplierPaymentQuality({ amount: 100, documentFingerprint: null });
  } catch {
    fingerprintGuardWorks = true;
  }

  const table = {
    health_200: health.status === 200 ? "PASS" : "FAIL",
    health_commit: String(health.body?.commit ?? "").startsWith(TARGET_COMMIT) ? "PASS" : "FAIL",
    migration_applied: migrationRows.length > 0 && uniqueIndex.length > 0 ? "PASS" : "FAIL",
    zero_amount_quarantined: counts.zero_unmarked === 0 ? "PASS" : "FAIL",
    fdr_no_approved_mismatch: counts.fdr_mismatch_approved === 0 ? "PASS" : "FAIL",
    cross_org_gsi_quarantined: counts.contaminated_gsi_active === 0 ? "PASS" : "FAIL",
    gsi_approved_no_payment: counts.gsi_approved_no_payment === 0 ? "REPORT" : "PASS",
    whatsapp_unique_constraint: whatsappUniqueWorks ? "PASS" : "FAIL",
    document_fingerprint_guard: fingerprintGuardWorks ? "PASS" : "FAIL",
    dashboard_api: dashboardRes.status === 200 && typeof dashboard.moneyToPay === "number" ? "PASS" : "FAIL",
    whatsapp_summary_api: waSummaryRes.status === 200 ? "PASS" : "FAIL",
  };

  console.log(
    JSON.stringify(
      {
        pilotOrg: PILOT,
        health: { status: health.status, commit: health.body?.commit, database: health.body?.database },
        migration: { rows: migrationRows, uniqueIndex },
        counts,
        dashboardKeys: dashboardRes.status === 200 ? Object.keys(dashboard) : null,
        waSummaryStatus: waSummaryRes.status,
        whatsappUniqueDetail,
        validationTable: table,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  const allCritical = [
    table.health_200,
    table.migration_applied,
    table.zero_amount_quarantined,
    table.fdr_no_approved_mismatch,
    table.cross_org_gsi_quarantined,
    table.whatsapp_unique_constraint,
    table.document_fingerprint_guard,
    table.dashboard_api,
  ].every((v) => v === "PASS");
  process.exit(allCritical ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
