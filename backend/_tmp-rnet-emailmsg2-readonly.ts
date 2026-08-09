/**
 * READ-ONLY: EmailMessage/attachment/scan path for Rnet+Bezeq message ids.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const ids = ["19f9e3d9101ed94d", "19f9e3d4a3621e8d"];
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD+ALLOW" }));
  process.exit(2);
}

async function main() {
  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const emails = await prisma.emailMessage.findMany({
      where: { organizationId: ORG, gmailId: { in: ids } },
      select: {
        id: true,
        gmailId: true,
        subject: true,
        fromAddress: true,
        receivedAt: true,
        processedAt: true,
        createdAt: true,
        snippet: true,
        source: true,
        bodyText: true,
        clientId: true,
      },
    });
    const atts = await prisma.emailAttachment.findMany({
      where: { emailMessageId: { in: emails.map((e) => e.id) } },
    });
    const gsi = await prisma.gmailScanItem.findMany({
      where: {
        organizationId: ORG,
        OR: [{ gmailMessageId: { in: ids } }, { emailMessageId: { in: emails.map((e) => e.id) } }],
      },
    });
    const fdr = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        OR: [{ gmailMessageId: { in: ids } }, { emailMessageId: { in: emails.map((e) => e.id) } }],
      },
    });
    const scans = await prisma.scanLog.findMany({
      where: { orgId: ORG, startedAt: { gte: new Date("2026-07-26T11:40:00Z") } },
      orderBy: { startedAt: "asc" },
      take: 40,
    });
    const gmailAuto = await prisma.scanLog.findMany({
      where: {
        orgId: ORG,
        startedAt: { gte: new Date("2026-07-26T00:00:00Z") },
        type: { in: ["gmail_auto", "gmail_retry", "first_time", "daily"] },
      },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
    const clients = await prisma.client.findMany({
      where: { organizationId: ORG },
      select: { id: true, name: true, email: true, isActive: true, gmailConnected: true },
    });
    const scanTypes = await prisma.scanLog.groupBy({
      by: ["type", "status"],
      where: { orgId: ORG, startedAt: { gte: new Date("2026-07-26T00:00:00Z") } },
      _count: true,
      _sum: { found: true, saved: true },
    });

    // GmailScanRun / lifecycle logs if model exists
    let scanRuns: any = null;
    try {
      scanRuns = await (prisma as any).gmailScanRun?.findMany?.({
        where: { organizationId: ORG, createdAt: { gte: new Date("2026-07-26T11:00:00Z") } },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    } catch {
      scanRuns = "model_unavailable";
    }

    const out = {
      emails: emails.map((e) => ({
        ...e,
        bodyLen: (e.bodyText || "").length,
        bodyPreview: (e.bodyText || "").slice(0, 240),
        wasProcessed: Boolean(e.processedAt),
        processedLagSec:
          e.processedAt && e.createdAt
            ? Math.round((e.processedAt.getTime() - e.createdAt.getTime()) / 1000)
            : null,
      })),
      atts,
      gsiCount: gsi.length,
      fdrCount: fdr.length,
      gsiSlim: gsi.map((g) => ({
        id: g.id,
        gmailMessageId: g.gmailMessageId,
        supplierName: g.supplierName,
        documentType: g.documentType,
        reviewStatus: g.reviewStatus,
        decisionReason: String(g.decisionReason || "").slice(0, 300),
        attachmentFilename: g.attachmentFilename,
        createdAt: g.createdAt,
      })),
      fdrSlim: fdr.map((f) => ({
        id: f.id,
        gmailMessageId: f.gmailMessageId,
        supplierName: f.supplierName,
        invoiceNumber: f.invoiceNumber,
        documentType: f.documentType,
        reviewStatus: f.reviewStatus,
        uncertaintyReason: f.uncertaintyReason,
        totalAmount: f.totalAmount,
        documentDate: f.documentDate,
        fileName: f.fileName,
        createdAt: f.createdAt,
      })),
      scansAfter1440: scans,
      gmailAutoScansToday: gmailAuto,
      clients,
      scanTypesToday: scanTypes,
      scanRuns,
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-emailmsg-diag.json"), JSON.stringify(out, null, 2));
    console.log(
      JSON.stringify(
        {
          emailCount: emails.length,
          emails: out.emails.map((e) => ({
            gmailId: e.gmailId,
            processedAt: e.processedAt,
            createdAt: e.createdAt,
            from: e.fromAddress,
            attCount: atts.filter((a) => a.emailMessageId === e.id).length,
          })),
          atts: atts.map((a) => ({
            emailMessageId: a.emailMessageId,
            filename: a.filename,
            mimeType: a.mimeType,
            driveUploadStatus: a.driveUploadStatus,
          })),
          gsi: out.gsiCount,
          fdr: out.fdrCount,
          scanTypesToday: scanTypes,
          gmailAutoCount: gmailAuto.length,
          clientsWithGmail: clients.filter((c) => c.gmailConnected).length,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
