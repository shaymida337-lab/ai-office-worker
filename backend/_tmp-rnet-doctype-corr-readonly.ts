/**
 * READ-ONLY: documentType correlation for live-missing vs live-present.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import {
  buildInvoiceListQueryContext,
  buildInvoiceListWhereInput,
  mapDocumentReviewToInvoiceCandidate,
  mapGmailScanItemToInvoiceCandidate,
} from "./src/routes/api.ts";
import {
  dedupeCompletionCandidatesPreferGsi,
  scanCompletionQueueFromSources,
  COMPLETION_SCAN_CHUNK,
  COMPLETION_SCAN_MAX_SOURCE_ROWS,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
  mergePrismaWhere,
} from "./src/services/p0/financialReadIsolation.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const API = "https://ai-office-worker-backend.onrender.com";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";

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
    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const baseWhere = buildInvoiceListWhereInput(ctx);
    const whereInput = {
      gmailScanItemWhere: mergePrismaWhere(
        baseWhere.gmailScanItemWhere as any,
        buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
      ),
      financialDocumentReviewWhere: mergePrismaWhere(
        baseWhere.financialDocumentReviewWhere as any,
        buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
      ),
    };

    const scanned = await scanCompletionQueueFromSources(
      [
        {
          name: "gmail_scan_item",
          load: ({ skip, take }) =>
            prisma.gmailScanItem.findMany({
              where: whereInput.gmailScanItemWhere,
              orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
              skip,
              take,
            }),
          map: (row: any) => ({
            ...mapGmailScanItemToInvoiceCandidate(row),
            emailMessageId: row.emailMessageId,
            duplicateKey: row.duplicateKey,
            documentFingerprint: row.duplicateKey,
          }),
        },
        {
          name: "financial_document_review",
          load: ({ skip, take }) =>
            prisma.financialDocumentReview.findMany({
              where: whereInput.financialDocumentReviewWhere,
              orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
              skip,
              take,
            }),
          map: (row: any) => ({
            ...mapDocumentReviewToInvoiceCandidate(row, ORG),
            emailMessageId: row.emailMessageId,
            documentFingerprint: row.documentFingerprint,
            duplicateKey: row.documentFingerprint,
          }),
        },
      ],
      {
        page: 1,
        pageSize: 100,
        sort: "date_desc",
        chunk: COMPLETION_SCAN_CHUNK,
        maxSourceRows: COMPLETION_SCAN_MAX_SOURCE_ROWS,
        dedupeCandidates: dedupeCompletionCandidatesPreferGsi,
      },
    );

    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const live = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const liveIds = new Set((live.rows || []).map((r: any) => r.id));

    const rows = (scanned.matched || []).map((c: any) => ({
      id: c.id,
      source: c.source,
      documentType: c.documentType,
      isComplete: c.isComplete,
      dataComplete: c.dataComplete,
      approvalRequired: c.approvalRequired,
      amount: c.amount,
      supplierName: c.supplierName,
      onLive: liveIds.has(c.id),
      decisionReason: String(c.decisionReason || "").slice(0, 80),
    }));

    const missing = rows.filter((r) => !r.onLive);
    const present = rows.filter((r) => r.onLive);

    const countBy = (list: typeof rows, key: keyof (typeof rows)[0]) => {
      const m: Record<string, number> = {};
      for (const r of list) {
        const k = String(r[key] ?? "null");
        m[k] = (m[k] || 0) + 1;
      }
      return m;
    };

    const out = {
      totals: { local: rows.length, live: live.total, missing: missing.length },
      missingByDocumentType: countBy(missing, "documentType"),
      presentByDocumentType: countBy(present, "documentType"),
      missingBySource: countBy(missing, "source"),
      presentBySource: countBy(present, "source"),
      missing,
      // Hypothesis: tax_invoice_receipt FDR all missing?
      taxInvoiceReceiptFdr: rows.filter(
        (r) => r.source === "financial_document_review" && r.documentType === "tax_invoice_receipt",
      ),
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-doctype-corr.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
