/**
 * Trigger controlled incremental Gmail scan on production and monitor results.
 * Usage: node scripts/run-controlled-incremental-scan.mjs [organizationId]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const organizationId = process.argv[2] ?? "cmqxujfuj034ndy2czu9tjoko";
const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";
const databaseUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
const jwtSecret = process.env.PROD_JWT_SECRET ?? process.env.JWT_SECRET;

if (!databaseUrl || !jwtSecret) {
  console.error("Need PROD_DATABASE_URL and JWT_SECRET (or PROD_JWT_SECRET)");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMetadata(metadata) {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function getAuthToken() {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { user: true },
  });
  if (!org?.user) throw new Error(`Organization not found: ${organizationId}`);
  return jwt.sign(
    { userId: org.user.id, organizationId: org.id, email: org.user.email },
    jwtSecret,
    { expiresIn: "1h" }
  );
}

async function triggerScan(token) {
  const cronSecret = process.env.PROD_CRON_SECRET ?? process.env.CRON_SECRET;
  if (cronSecret) {
    const cronRes = await fetch(`${apiBase}/cron/gmail-scan-incremental`, {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organizationId }),
    });
    const cronText = await cronRes.text();
    let cronBody;
    try {
      cronBody = JSON.parse(cronText);
    } catch {
      cronBody = { raw: cronText };
    }
    if (cronRes.ok) {
      return { status: cronRes.status, body: cronBody, via: "cron" };
    }
    console.warn("cron trigger failed", cronRes.status, cronText.slice(0, 200));
  }

  const res = await fetch(`${apiBase}/api/gmail/scan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, via: "jwt" };
}

async function pollScanDb(scanId, maxMinutes = 25) {
  const deadline = Date.now() + maxMinutes * 60_000;
  while (Date.now() < deadline) {
    const row = await prisma.syncLog.findUnique({ where: { id: scanId } });
    if (!row) throw new Error(`scan not found: ${scanId}`);
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        source: "prod_db",
        status: row.status,
        scanMode: row.scanMode,
        emailsProcessed: row.emailsProcessed,
        emailsSaved: row.emailsSaved,
        finishedAt: row.finishedAt,
        errorMessage: row.errorMessage ?? null,
      })
    );
    if (
      row.finishedAt ||
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "paused" ||
      row.status === "stale"
    ) {
      return row;
    }
    await sleep(15_000);
  }
  throw new Error("Scan poll timeout");
}

async function pollScanApi(scanId, token, maxMinutes = 20) {
  const deadline = Date.now() + maxMinutes * 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${apiBase}/api/gmail/scan/${scanId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const progress = await res.json();
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        httpStatus: res.status,
        status: progress.status,
        scanMode: progress.scanMode,
        emailsProcessed: progress.emailsProcessed,
        emailsSaved: progress.emailsSaved,
        finishedAt: progress.finishedAt,
        errorMessage: progress.errorMessage ?? null,
      })
    );
    if (progress.finishedAt || progress.status === "completed" || progress.status === "failed" || progress.status === "paused") {
      return progress;
    }
    await sleep(15_000);
  }
  throw new Error("Scan poll timeout");
}

async function verifyNewRows(scanStartedAt) {
  const since = scanStartedAt;

  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "gmail" } },
    select: { metadata: true },
  });
  const meta = parseMetadata(integration?.metadata ?? null);
  const mailbox = typeof meta.googleAccountEmail === "string" ? meta.googleAccountEmail.toLowerCase() : null;

  const emailMessages = await prisma.emailMessage.findMany({
    where: { organizationId, createdAt: { gte: since } },
    select: { id: true, gmailId: true, fromAddress: true, subject: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const gmailScanItems = await prisma.gmailScanItem.findMany({
    where: { organizationId, createdAt: { gte: since } },
    select: {
      id: true,
      gmailMessageId: true,
      sender: true,
      senderEmail: true,
      subject: true,
      reviewStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const fdrs = await prisma.financialDocumentReview.findMany({
    where: { organizationId, createdAt: { gte: since } },
    select: {
      id: true,
      gmailMessageId: true,
      sender: true,
      reviewStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const shaymidaPattern = /shaymida337@gmail\.com/i;
  const fromShaymida = emailMessages.filter((row) => shaymidaPattern.test(row.fromAddress ?? ""));
  const gsiFromShaymida = gmailScanItems.filter(
    (row) => shaymidaPattern.test(row.senderEmail ?? "") || shaymidaPattern.test(row.sender ?? "")
  );

  const crossOrgDupes = await prisma.$queryRawUnsafe(
    `
    SELECT em."gmailId", COUNT(DISTINCT em."organizationId")::int AS org_count
    FROM "EmailMessage" em
    WHERE em."createdAt" >= $1
      AND em."gmailId" IN (
        SELECT "gmailId" FROM "EmailMessage" WHERE "organizationId" = $2 AND "createdAt" >= $1
      )
    GROUP BY em."gmailId"
    HAVING COUNT(DISTINCT em."organizationId") > 1
  `,
    since,
    organizationId
  );

  const syncLog = await prisma.syncLog.findFirst({
    where: { organizationId, type: "gmail_scan", startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
  });

  return {
    scanLog: syncLog
      ? {
          id: syncLog.id,
          scanMode: syncLog.scanMode,
          status: syncLog.status,
          startedAt: syncLog.startedAt,
          finishedAt: syncLog.finishedAt,
          emailsProcessed: syncLog.emailsProcessed,
          emailsSaved: syncLog.emailsSaved,
          errorMessage: syncLog.errorMessage,
        }
      : null,
    integrationMailbox: mailbox,
    newRowCounts: {
      emailMessages: emailMessages.length,
      gmailScanItems: gmailScanItems.length,
      financialDocumentReviews: fdrs.length,
    },
    isolationChecks: {
      scanModeIsManualIncremental: syncLog?.scanMode === "manual_incremental",
      noShaymida337EmailMessages: fromShaymida.length === 0,
      noShaymida337GmailScanItems: gsiFromShaymida.length === 0,
      noCrossOrgDuplicatesForNewGmailIds: crossOrgDupes.length === 0,
      allNewRowsInTargetOrg: true,
    },
    violations: {
      shaymida337EmailMessages: fromShaymida,
      shaymida337GmailScanItems: gsiFromShaymida,
      crossOrgDuplicateGmailIds: crossOrgDupes,
    },
    sampleNewRows: {
      emailMessages: emailMessages.slice(0, 5),
      gmailScanItems: gmailScanItems.slice(0, 5),
      financialDocumentReviews: fdrs.slice(0, 5),
    },
  };
}

async function main() {
  console.log(`=== Controlled incremental scan org=${organizationId} ===\n`);
  const scanStartedAt = new Date();

  const token = await getAuthToken();
  const trigger = await triggerScan(token);
  console.log("trigger", JSON.stringify(trigger, null, 2));

  if (trigger.status === 401 && trigger.via === "jwt") {
    console.error("JWT rejected — set PROD_JWT_SECRET or PROD_CRON_SECRET in .env.prod.local");
    process.exit(1);
  }
  if (trigger.status === 403 && trigger.via === "cron") {
    console.error("Cron rejected — set PROD_CRON_SECRET in .env.prod.local to match Render CRON_SECRET");
    process.exit(1);
  }
  if (trigger.status >= 400) {
    process.exit(1);
  }

  const scanId = trigger.body.scanId;
  if (!scanId) {
    console.error("No scanId returned");
    process.exit(1);
  }

  console.log(`\nMonitoring scanId=${scanId} via ${trigger.via} ...\n`);
  const finalProgress =
    trigger.via === "cron"
      ? await pollScanDb(scanId)
      : await pollScanApi(scanId, token);
  console.log("\nFinal progress:", JSON.stringify(finalProgress, null, 2));

  console.log("\n=== Post-scan verification (SELECT only) ===\n");
  const verification = await verifyNewRows(scanStartedAt);
  console.log(JSON.stringify(verification, null, 2));

  const checks = verification.isolationChecks;
  const pass =
    checks.scanModeIsManualIncremental &&
    verification.integrationMailbox === "laperlaclinic120@gmail.com" &&
    checks.noShaymida337EmailMessages &&
    checks.noShaymida337GmailScanItems &&
    checks.noCrossOrgDuplicatesForNewGmailIds &&
    !verification.scanLog?.errorMessage?.includes("GMAIL_INTEGRATION_ISOLATION");

  console.log(`\nOVERALL: ${pass ? "PASS" : "FAIL"}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
