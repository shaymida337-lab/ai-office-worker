/**
 * READ-ONLY: last ingest activity + containment / audit for Shay org.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD_DATABASE_URL + ALLOW_REMOTE_READONLY_REPORT=1" }));
  process.exit(2);
}

const ORG_ID = process.env.VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";
const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
u.searchParams.set("connection_limit", "3");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

async function main() {
  const since6h = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [lastFdr, lastGsi, lastInv, lastCam, fdr6h, gsi6h, cam6hAllOrgs] = await Promise.all([
    prisma.financialDocumentReview.findFirst({
      where: { organizationId: ORG_ID },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        source: true,
        fileName: true,
        supplierName: true,
        totalAmount: true,
        reviewStatus: true,
        uncertaintyReason: true,
        createdAt: true,
      },
    }),
    prisma.gmailScanItem.findFirst({
      where: { organizationId: ORG_ID },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        subject: true,
        attachmentFilename: true,
        supplierName: true,
        amount: true,
        reviewStatus: true,
        decisionReason: true,
        createdAt: true,
      },
    }),
    prisma.invoice.findFirst({
      where: { organizationId: ORG_ID },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        supplierName: true,
        amount: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.financialDocumentReview.findFirst({
      where: { organizationId: ORG_ID, source: "camera" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileName: true,
        supplierName: true,
        totalAmount: true,
        reviewStatus: true,
        uncertaintyReason: true,
        createdAt: true,
      },
    }),
    prisma.financialDocumentReview.count({
      where: { organizationId: ORG_ID, createdAt: { gte: since6h } },
    }),
    prisma.gmailScanItem.count({
      where: { organizationId: ORG_ID, createdAt: { gte: since6h } },
    }),
    prisma.financialDocumentReview.findMany({
      where: { source: "camera", createdAt: { gte: since6h } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        organizationId: true,
        fileName: true,
        supplierName: true,
        totalAmount: true,
        reviewStatus: true,
        uncertaintyReason: true,
        createdAt: true,
      },
    }),
  ]);

  // AuditLog if exists
  let audits: unknown[] = [];
  try {
    audits = await prisma.auditLog.findMany({
      where: {
        OR: [{ organizationId: ORG_ID }, { entityId: ORG_ID }],
        createdAt: { gte: since6h },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        organizationId: true,
        action: true,
        entityType: true,
        entityId: true,
        message: true,
        createdAt: true,
      },
    });
  } catch (e) {
    audits = [{ error: String((e as Error).message) }];
  }

  // Gmail connection / scan job status if models exist
  let gmailConn: unknown = null;
  try {
    gmailConn = await prisma.gmailConnection.findFirst({
      where: { organizationId: ORG_ID },
      select: {
        id: true,
        email: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        updatedAt: true,
      },
    });
  } catch (e) {
    try {
      gmailConn = await prisma.googleConnection.findFirst({
        where: { organizationId: ORG_ID },
        select: { id: true, email: true, updatedAt: true },
      });
    } catch (e2) {
      gmailConn = { error: String((e as Error).message), error2: String((e2 as Error).message) };
    }
  }

  // Any FDR in last 24h for org (broader)
  const fdr24 = await prisma.financialDocumentReview.findMany({
    where: { organizationId: ORG_ID, createdAt: { gte: since24h } },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      source: true,
      fileName: true,
      supplierName: true,
      totalAmount: true,
      reviewStatus: true,
      uncertaintyReason: true,
      createdAt: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        now: new Date().toISOString(),
        orgId: ORG_ID,
        counts6h: { fdr: fdr6h, gsi: gsi6h },
        lastFdr: lastFdr
          ? { ...lastFdr, createdAt: lastFdr.createdAt.toISOString() }
          : null,
        lastCamera: lastCam
          ? { ...lastCam, createdAt: lastCam.createdAt.toISOString() }
          : null,
        lastGsi: lastGsi
          ? { ...lastGsi, createdAt: lastGsi.createdAt.toISOString() }
          : null,
        lastInvoice: lastInv
          ? { ...lastInv, createdAt: lastInv.createdAt.toISOString() }
          : null,
        cameraUploadsAllOrgs6h: cam6hAllOrgs.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
        fdrLast24h: fdr24.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
        gmailConn,
        audits: audits.map((a: any) =>
          a?.createdAt
            ? { ...a, createdAt: new Date(a.createdAt).toISOString() }
            : a
        ),
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
  .finally(() => prisma.$disconnect());
