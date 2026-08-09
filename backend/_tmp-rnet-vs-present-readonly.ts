/**
 * READ-ONLY: diff Rnet (missing) vs עיריית רמת גן (present on live) — same BLOCKED reason.
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

const IDS = {
  rnet: "cmqw3n5hx020dm92bp1joi8wu",
  bezeq: "cmqw3onmp0227m92bemcb1bkm",
  ramatGanPresent: "cmqxf61ak0b2zjx2dna3832rx",
  detectedPresent: "cmqxf65y40b31jx2d0snodln4",
};

async function loadJwtSecret() {
  const renderKey = process.env.RENDER_API_KEY?.trim();
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

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const rows = await prisma.financialDocumentReview.findMany({
      where: { id: { in: Object.values(IDS) } },
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    // Related GSI by fingerprint / gmail / email
    const related = [];
    for (const [label, id] of Object.entries(IDS)) {
      const fdr = byId[id];
      if (!fdr) continue;
      const gsis = await prisma.gmailScanItem.findMany({
        where: {
          organizationId: ORG,
          OR: [
            ...(fdr.documentFingerprint ? [{ duplicateKey: fdr.documentFingerprint }] : []),
            ...(fdr.emailMessageId ? [{ emailMessageId: fdr.emailMessageId }] : []),
            ...(fdr.gmailMessageId ? [{ gmailMessageId: fdr.gmailMessageId }] : []),
          ],
        },
        select: {
          id: true,
          reviewStatus: true,
          decisionReason: true,
          duplicateKey: true,
          emailMessageId: true,
          gmailMessageId: true,
          documentType: true,
          amount: true,
          supplierName: true,
        },
      });
      related.push({
        label,
        fdr: {
          id: fdr.id,
          reviewStatus: fdr.reviewStatus,
          documentType: fdr.documentType,
          supplierName: fdr.supplierName,
          totalAmount: fdr.totalAmount,
          invoiceNumber: fdr.invoiceNumber,
          documentDate: fdr.documentDate,
          normalizedDocumentDate: fdr.normalizedDocumentDate,
          createdAt: fdr.createdAt,
          updatedAt: fdr.updatedAt,
          fingerprint: fdr.documentFingerprint,
          emailMessageId: fdr.emailMessageId,
          gmailMessageId: fdr.gmailMessageId,
          supplierPaymentId: fdr.supplierPaymentId,
          confidenceScore: fdr.confidenceScore,
          uncertaintyReason: fdr.uncertaintyReason,
          source: fdr.source,
          parsedFieldsKeys:
            fdr.parsedFieldsJson && typeof fdr.parsedFieldsJson === "object"
              ? Object.keys(fdr.parsedFieldsJson as object).slice(0, 40)
              : [],
        },
        mirrorGsis: gsis,
      });
    }

    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

    // Live search by invoice numbers / amounts
    const searches = ["OV255006399", "238419712", "ערנט", "בזק", "רמת גן", "354", "163.28"];
    const searchResults: Record<string, any> = {};
    for (const q of searches) {
      const body = await (
        await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=50&search=${encodeURIComponent(q)}`, {
          headers,
        })
      ).json();
      searchResults[q] = {
        total: body.total,
        ids: (body.rows || []).map((r: any) => ({ id: r.id, amount: r.amount, supplierName: r.supplierName })),
      };
    }

    // Also check document-reviews endpoint if exists
    const reviewEndpoints = [
      `/api/document-reviews?search=${encodeURIComponent("OV255006399")}`,
      `/api/financial-document-reviews?search=${encodeURIComponent("OV255006399")}`,
      `/api/invoices/list?completeness=incomplete&search=${encodeURIComponent("OV255006399")}`,
    ];
    const other: Record<string, any> = {};
    for (const path of reviewEndpoints) {
      try {
        const res = await fetch(`${API}${path}`, { headers });
        other[path] = { status: res.status, body: await res.json().catch(() => null) };
      } catch (e) {
        other[path] = { error: String(e) };
      }
    }

    const out = { related, searchResults, other };
    writeFileSync(join(process.cwd(), "_tmp-rnet-vs-present.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
