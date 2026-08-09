/**
 * READ-ONLY prod diagnosis: invoices sent ~last hour not appearing.
 * No mutations. Requires ALLOW_REMOTE_READONLY_REPORT=1 + PROD_DATABASE_URL.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}
if (existsSync(join(process.cwd(), "..", ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), "..", ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || /localhost|127\.0\.0\.1/.test(prodUrl)) {
  console.error(JSON.stringify({ error: "PROD_DATABASE_URL required (non-local)" }));
  process.exit(2);
}
if (process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "Set ALLOW_REMOTE_READONLY_REPORT=1" }));
  process.exit(2);
}

const ORG_ID = process.env.VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";
const hours = Number(process.env.DIAG_HOURS ?? "2");
const since = new Date(Date.now() - hours * 60 * 60 * 1000);

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
u.searchParams.set("connection_limit", "3");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

function summarizeFdr(row: {
  id: string;
  organizationId: string;
  source: string;
  fileName: string | null;
  subject: string | null;
  supplierName: string | null;
  totalAmount: number | null;
  documentType: string;
  reviewStatus: string;
  uncertaintyReason: string | null;
  driveUploadStatus: string | null;
  gmailMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    fileName: row.fileName,
    subject: row.subject,
    supplierName: row.supplierName,
    totalAmount: row.totalAmount,
    documentType: row.documentType,
    reviewStatus: row.reviewStatus,
    uncertaintyReason: row.uncertaintyReason,
    driveUploadStatus: row.driveUploadStatus,
    gmailMessageId: row.gmailMessageId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function main() {
  const org = await prisma.organization.findUnique({
    where: { id: ORG_ID },
    select: { id: true, name: true },
  });

  const fdrOrg = await prisma.financialDocumentReview.findMany({
    where: { organizationId: ORG_ID, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const fdrAllRecent = await prisma.financialDocumentReview.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      organizationId: true,
      source: true,
      fileName: true,
      subject: true,
      supplierName: true,
      totalAmount: true,
      documentType: true,
      reviewStatus: true,
      uncertaintyReason: true,
      driveUploadStatus: true,
      gmailMessageId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const gsiOrg = await prisma.gmailScanItem.findMany({
    where: { organizationId: ORG_ID, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      organizationId: true,
      subject: true,
      sender: true,
      attachmentFilename: true,
      supplierName: true,
      amount: true,
      documentType: true,
      reviewStatus: true,
      decisionReason: true,
      driveUploadStatus: true,
      gmailMessageId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const gsiAllRecent = await prisma.gmailScanItem.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      organizationId: true,
      subject: true,
      attachmentFilename: true,
      supplierName: true,
      amount: true,
      documentType: true,
      reviewStatus: true,
      decisionReason: true,
      createdAt: true,
    },
  });

  const invoicesOrg = await prisma.invoice.findMany({
    where: { organizationId: ORG_ID, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      organizationId: true,
      supplierName: true,
      amount: true,
      invoiceNumber: true,
      status: true,
      gmailMessageId: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const paymentsOrg = await prisma.supplierPayment.findMany({
    where: { organizationId: ORG_ID, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      organizationId: true,
      supplierName: true,
      amount: true,
      documentTypeDetailed: true,
      approvalStatus: true,
      duplicateDetected: true,
      duplicateReason: true,
      firstSource: true,
      createdAt: true,
    },
  });

  // Also check updatedAt window (reprocessed drafts)
  const fdrUpdated = await prisma.financialDocumentReview.findMany({
    where: { organizationId: ORG_ID, updatedAt: { gte: since }, createdAt: { lt: since } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      source: true,
      fileName: true,
      supplierName: true,
      totalAmount: true,
      reviewStatus: true,
      uncertaintyReason: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const orgCounts = {
    fdrCreated: fdrOrg.length,
    gsiCreated: gsiOrg.length,
    invoiceCreated: invoicesOrg.length,
    supplierPaymentCreated: paymentsOrg.length,
    fdrUpdatedOnly: fdrUpdated.length,
  };

  const otherOrgsFdr = fdrAllRecent.filter((r) => r.organizationId !== ORG_ID);
  const otherOrgsGsi = gsiAllRecent.filter((r) => r.organizationId !== ORG_ID);

  console.log(
    JSON.stringify(
      {
        since: since.toISOString(),
        hours,
        now: new Date().toISOString(),
        org,
        orgCounts,
        fdrOrg: fdrOrg.map(summarizeFdr),
        fdrUpdatedOnly: fdrUpdated.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        gsiOrg: gsiOrg.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        invoicesOrg: invoicesOrg.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        paymentsOrg: paymentsOrg.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
        crossTenantRecent: {
          fdrOtherOrgsCount: otherOrgsFdr.length,
          gsiOtherOrgsCount: otherOrgsGsi.length,
          fdrOtherOrgsSample: otherOrgsFdr.slice(0, 10).map(summarizeFdr),
          gsiOtherOrgsSample: gsiAllRecent
            .filter((r) => r.organizationId !== ORG_ID)
            .slice(0, 10)
            .map((r) => ({
              id: r.id,
              organizationId: r.organizationId,
              subject: r.subject,
              attachmentFilename: r.attachmentFilename,
              supplierName: r.supplierName,
              amount: r.amount,
              documentType: r.documentType,
              reviewStatus: r.reviewStatus,
              decisionReason: r.decisionReason,
              createdAt: r.createdAt.toISOString(),
            })),
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
