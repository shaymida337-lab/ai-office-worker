/**
 * READ-ONLY: check prod backend commit + Yellow FDR state + reprocess path notes
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const TARGET = "1233079ec34683d4571d6a41133360ee292a85eb";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const FDR_ID = "cms1nvpvp00pbjn2cwks9a78b";
const GMAIL_MSG = "19f9d94a517d5d86";
const API = "https://ai-office-worker-backend.onrender.com";
const RENDER_SERVICE = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const renderKey = process.env.RENDER_API_KEY?.trim();

const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD_DATABASE_URL + ALLOW_REMOTE_READONLY_REPORT=1" }));
  process.exit(2);
}

async function main() {
  const healthRes = await fetch(`${API}/api/health`);
  const health = await healthRes.json();

  let deploySummary = null;
  if (renderKey) {
    const res = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE}/deploys?limit=5`, {
      headers: { Authorization: `Bearer ${renderKey}`, Accept: "application/json" },
    });
    const body = await res.json();
    const rows = Array.isArray(body) ? body : [];
    deploySummary = rows.slice(0, 5).map((row) => {
      const d = row.deploy ?? row;
      const commitId = d.commit?.id ?? d.commitId ?? null;
      return {
        id: d.id,
        status: d.status,
        createdAt: d.createdAt,
        finishedAt: d.finishedAt,
        commit: commitId,
        commitShort: typeof commitId === "string" ? commitId.slice(0, 7) : null,
        message: d.commit?.message?.slice?.(0, 100) ?? null,
        matchesTarget: typeof commitId === "string" && commitId.startsWith("1233079"),
      };
    });
  }

  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

  try {
    const focus = await prisma.financialDocumentReview.findFirst({
      where: { id: FDR_ID, organizationId: ORG },
      select: {
        id: true,
        supplierName: true,
        totalAmount: true,
        gmailMessageId: true,
        documentFingerprint: true,
        sourceFingerprint: true,
        reviewStatus: true,
        uncertaintyReason: true,
        updatedAt: true,
        createdAt: true,
        fileName: true,
      },
    });

    const sameMessage = await prisma.financialDocumentReview.findMany({
      where: { organizationId: ORG, gmailMessageId: GMAIL_MSG },
      select: {
        id: true,
        supplierName: true,
        totalAmount: true,
        documentFingerprint: true,
        createdAt: true,
        reviewStatus: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const amountMatches = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        totalAmount: 418.39,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        supplierName: true,
        totalAmount: true,
        gmailMessageId: true,
        documentFingerprint: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const pazRecent = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        OR: [
          { supplierName: "פז" },
          { supplierName: { contains: "yellow", mode: "insensitive" } },
        ],
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        supplierName: true,
        totalAmount: true,
        gmailMessageId: true,
        createdAt: true,
      },
      take: 10,
    });

    const liveCommit = typeof health?.commit === "string" ? health.commit : null;
    const onTarget =
      liveCommit === TARGET ||
      (typeof liveCommit === "string" && TARGET.startsWith(liveCommit)) ||
      (typeof liveCommit === "string" && liveCommit.startsWith("1233079"));

    const out = {
      checkedAt: new Date().toISOString(),
      targetCommit: TARGET,
      health: {
        status: healthRes.status,
        commit: liveCommit,
        version: health?.version ?? null,
        buildTime: health?.buildTime ?? null,
        serverStartedAt: health?.serverStartedAt ?? null,
        deployId: health?.deployId ?? null,
        onTargetCommit: onTarget,
      },
      renderDeploys: deploySummary,
      reprocessPaths: {
        singleDocumentOfficial: false,
        unsafeOrgWideRescanInvoices: {
          path: "POST /api/gmail/rescan-invoices",
          whyUnsafe: "Deletes org Gmail invoices, supplierPayments, gmailScanItems and resets emails",
        },
        forceReprocess90d: {
          paths: ["POST /api/debug/gmail/scan-90", "POST /api/help/auto-fix/invoices", "POST /api/gmail/scan with daysBack>=90"],
          whyNotPreferred: "Org-wide force reprocess; not document-scoped; risk of noise/duplicates",
        },
        recommendation: "No safe official single-document reprocess. User should resend email.",
      },
      yellowFdr: focus,
      sameGmailMessageFdrs: sameMessage,
      amount418Recent: amountMatches,
      pazOrYellowRecent: pazRecent,
      verification: {
        supplierIsPaz: focus?.supplierName === "פז",
        amountOk: focus?.totalAmount === 418.39,
        duplicateSameMessageCount: sameMessage.length,
      },
    };

    writeFileSync(join(process.cwd(), "_tmp-prod-yellow-deploy-verify.json"), JSON.stringify(out, null, 2), "utf8");
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
