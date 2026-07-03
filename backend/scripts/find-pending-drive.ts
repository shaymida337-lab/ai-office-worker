/**
 * find-pending-drive.ts — איתור רשומות שממתינות להעלאת Drive (שלב 5).
 *
 * READ-ONLY: מדפיס את כל הרשומות עם driveUploadStatus=pending_retry/failed
 * או קובץ מקומי במקום קישור Drive — כדי שאפשר יהיה להשלים אותן
 * (ה-retry האוטומטי רץ בכל סנכרון, אבל כאן רואים את התמונה המלאה).
 *
 * בטיחות: מסרב לרוץ אם DATABASE_URL אינו localhost.
 * הרצה: cd backend && npx tsx scripts/find-pending-drive.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(join(backendRoot, ".env"), "utf8");
  const line = envText.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in backend/.env");
  return line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}

const databaseUrl = loadDatabaseUrl();
const host = new URL(databaseUrl.replace(/^postgresql:/, "http:")).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(`REFUSING TO RUN: DATABASE_URL host is "${host}" (not localhost).`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const PENDING_STATUSES = ["pending_retry", "failed"];

async function main() {
  const [attachments, gsi, fdr, payments, invoices] = await Promise.all([
    prisma.emailAttachment.findMany({
      where: { driveUploadStatus: { in: PENDING_STATUSES } },
      select: {
        id: true, filename: true, driveUploadStatus: true, createdAt: true,
        emailMessage: { select: { organizationId: true, gmailId: true, subject: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.gmailScanItem.findMany({
      where: { driveUploadStatus: { in: PENDING_STATUSES } },
      select: { id: true, organizationId: true, gmailMessageId: true, supplierName: true, attachmentFilename: true, driveUploadStatus: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.financialDocumentReview.findMany({
      where: {
        OR: [
          { driveUploadStatus: { in: PENDING_STATUSES } },
          { driveFileUrl: { startsWith: "/uploads/" } },
        ],
      },
      select: { id: true, organizationId: true, source: true, supplierName: true, fileName: true, driveFileUrl: true, driveUploadStatus: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.supplierPayment.findMany({
      where: { driveUploadStatus: { in: PENDING_STATUSES } },
      select: { id: true, organizationId: true, supplier: true, amount: true, source: true, driveUploadStatus: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invoice.findMany({
      where: { driveUploadStatus: { in: PENDING_STATUSES } },
      select: { id: true, organizationId: true, supplierName: true, amount: true, driveUploadStatus: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  console.log(`find-pending-drive | ${new Date().toISOString()} | host=${host} | READ-ONLY`);
  const total = attachments.length + gsi.length + fdr.length + payments.length + invoices.length;
  console.log(`סה"כ רשומות ממתינות ל-Drive: ${total}\n`);

  if (attachments.length) {
    console.log(`\n### EmailAttachment (${attachments.length}) — ה-retry האוטומטי מטפל עד 20 בכל סנכרון`);
    for (const a of attachments) {
      console.log(`  ${a.id} | org=${a.emailMessage.organizationId} | status=${a.driveUploadStatus} | file="${a.filename}" | gmail=${a.emailMessage.gmailId} | ${a.createdAt.toISOString().slice(0, 10)}`);
    }
  }
  if (gsi.length) {
    console.log(`\n### GmailScanItem (${gsi.length})`);
    for (const g of gsi) {
      console.log(`  ${g.id} | org=${g.organizationId} | status=${g.driveUploadStatus} | supplier="${g.supplierName}" | file="${g.attachmentFilename ?? "-"}" | gmail=${g.gmailMessageId}`);
    }
  }
  if (fdr.length) {
    console.log(`\n### FinancialDocumentReview (${fdr.length}) — כולל רשומות מצלמה עם קובץ מקומי בלבד`);
    for (const f of fdr) {
      console.log(`  ${f.id} | org=${f.organizationId} | source=${f.source} | status=${f.driveUploadStatus ?? "-"} | supplier="${f.supplierName ?? "-"}" | link=${f.driveFileUrl ?? "-"}`);
    }
  }
  if (payments.length) {
    console.log(`\n### SupplierPayment (${payments.length})`);
    for (const p of payments) {
      console.log(`  ${p.id} | org=${p.organizationId} | source=${p.source} | status=${p.driveUploadStatus} | supplier="${p.supplier}" | amount=${p.amount}`);
    }
  }
  if (invoices.length) {
    console.log(`\n### Invoice (${invoices.length})`);
    for (const i of invoices) {
      console.log(`  ${i.id} | org=${i.organizationId} | status=${i.driveUploadStatus} | supplier="${i.supplierName ?? "-"}" | amount=${i.amount}`);
    }
  }
  if (!total) console.log("(אין רשומות ממתינות — הכול הועלה)");
}

main()
  .catch((err) => {
    console.error("find-pending-drive failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
