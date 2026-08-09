/**
 * READ-ONLY: why Rnet FDR not in completion list + Bezeq classification evidence.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const API = "https://ai-office-worker-backend.onrender.com";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const RNET_FDR = "cmqw3n5hx020dm92bp1joi8wu";
const BEZEQ_FDR = "cmqw3onmp0227m92bemcb1bkm";
const renderKey = process.env.RENDER_API_KEY?.trim();
const prodUrl = process.env.PROD_DATABASE_URL ?? "";

async function loadJwtSecret() {
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${renderKey}`, Accept: "application/json" },
    });
    const data = await res.json();
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && typeof val === "string") return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor || data.length < 100) break;
    url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100&cursor=${cursor}`;
  }
  return process.env.JWT_SECRET;
}

function textEvidence(raw: any) {
  const s = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return {
    len: s.length,
    hasNegation: s.includes("אינו מהווה חשבונית"),
    hasRnet: /rnet|ערנט|OV255006399/i.test(s),
    hasBezeq: /בזק|bezeq/i.test(s),
    hasAccountMgmt: /ניהול חשבון|אישור ניהול/i.test(s),
    preview: s.slice(0, 800),
  };
}

async function main() {
  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const fdrs = await prisma.financialDocumentReview.findMany({
      where: { id: { in: [RNET_FDR, BEZEQ_FDR] }, organizationId: ORG },
      select: {
        id: true,
        gmailMessageId: true,
        emailMessageId: true,
        supplierName: true,
        invoiceNumber: true,
        fileName: true,
        documentType: true,
        documentDate: true,
        totalAmount: true,
        reviewStatus: true,
        uncertaintyReason: true,
        documentFingerprint: true,
        sourceFingerprint: true,
        createdAt: true,
        updatedAt: true,
        parsedFieldsJson: true,
        rawAnalysis: true,
      },
    });

    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" };

    const listRes = await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers });
    const listBody = await listRes.json();
    const rows = Array.isArray(listBody.rows) ? listBody.rows : [];
    const hitRnet = rows.filter(
      (r: any) =>
        String(r.id || "").includes(RNET_FDR) ||
        String(r.reviewSourceId || "") === RNET_FDR ||
        Number(r.amount) === 354 ||
        /ערנט|rnet|OV255/i.test(String(r.supplierName || "")) ||
        String(r.gmailMessageId || "") === "19f9e3d9101ed94d" ||
        String(r.gmailMessageId || "") === "19ee12f8ab9f4579",
    );
    const hitBezeq = rows.filter(
      (r: any) =>
        String(r.id || "").includes(BEZEQ_FDR) ||
        String(r.reviewSourceId || "") === BEZEQ_FDR ||
        /בזק|bezeq/i.test(String(r.supplierName || "")) ||
        String(r.gmailMessageId || "") === "19f9e3d4a3621e8d" ||
        String(r.gmailMessageId || "") === "19ed663d168fc8dc",
    );

    const invRes = await fetch(`${API}/api/invoices/list?page=1&pageSize=100&sort=date_desc`, { headers });
    const invBody = await invRes.json();
    const invoices = Array.isArray(invBody.invoices) ? invBody.invoices : Array.isArray(invBody.rows) ? invBody.rows : [];
    const invRnet = invoices.filter(
      (r: any) =>
        Number(r.amount) === 354 ||
        /ערנט|rnet|OV255/i.test(String(r.supplierName || "")) ||
        String(r.id || "").includes(RNET_FDR),
    );

    const syncAround = await prisma.syncLog.findMany({
      where: {
        organizationId: ORG,
        type: "gmail_scan",
        startedAt: { gte: new Date("2026-07-26T11:40:00Z"), lte: new Date("2026-07-26T11:55:00Z") },
      },
      orderBy: { startedAt: "asc" },
    });

    const out = {
      fdrs: fdrs.map((f) => ({
        id: f.id,
        gmailMessageId: f.gmailMessageId,
        emailMessageId: f.emailMessageId,
        supplierName: f.supplierName,
        invoiceNumber: f.invoiceNumber,
        fileName: f.fileName,
        documentType: f.documentType,
        documentDate: f.documentDate,
        totalAmount: f.totalAmount,
        reviewStatus: f.reviewStatus,
        uncertaintyReason: f.uncertaintyReason,
        documentFingerprint: f.documentFingerprint,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        parsed: {
          outcome: (f.parsedFieldsJson as any)?.outcome ?? null,
          trust: (f.parsedFieldsJson as any)?.trust ?? null,
          fse: (f.parsedFieldsJson as any)?.fse ?? null,
          amountGate: (f.parsedFieldsJson as any)?.amountGate ?? null,
          supplierGate: (f.parsedFieldsJson as any)?.supplierGate ?? null,
        },
        ocrEvidence: textEvidence(f.rawAnalysis),
      })),
      completionList: {
        status: listRes.status,
        total: listBody.total,
        rowCount: rows.length,
        hitRnet: hitRnet.map((r: any) => ({
          id: r.id,
          source: r.source,
          amount: r.amount,
          supplierName: r.supplierName,
          reviewStatus: r.reviewStatus,
          uncertaintyReason: r.uncertaintyReason,
        })),
        hitBezeq: hitBezeq.map((r: any) => ({
          id: r.id,
          source: r.source,
          amount: r.amount,
          supplierName: r.supplierName,
          reviewStatus: r.reviewStatus,
        })),
      },
      invoicesListRnet: invRnet.map((r: any) => ({ id: r.id, amount: r.amount, supplierName: r.supplierName, source: r.source })),
      syncAround: syncAround.map((s) => ({
        id: s.id,
        status: s.status,
        scanMode: s.scanMode,
        emailsProcessed: s.emailsProcessed,
        emailsSaved: (s as any).emailsSaved,
        invoicesFound: (s as any).invoicesFound,
        totalMatched: s.totalMatched,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        errorMessage: s.errorMessage ? String(s.errorMessage).slice(0, 300) : null,
      })),
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-ui-presence-diag.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
