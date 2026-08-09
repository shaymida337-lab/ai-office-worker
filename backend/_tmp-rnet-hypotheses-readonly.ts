/**
 * READ-ONLY: inspect live response headers/timing + compare exact ID sets.
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
  const secret = await loadJwtSecret();
  const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
  const res = await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const body = await res.json();

  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const base = buildInvoiceListWhereInput(ctx);
    const whereInput = {
      gmailScanItemWhere: mergePrismaWhere(
        base.gmailScanItemWhere as any,
        buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
      ),
      financialDocumentReviewWhere: mergePrismaWhere(
        base.financialDocumentReviewWhere as any,
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

    // Check: if we filter OUT dataComplete&&approvalRequired (WIP-ish) OR filter out tax_invoice_receipt
    const matched = scanned.matched || [];
    const noTir = matched.filter((c: any) => c.documentType !== "tax_invoice_receipt");
    const onlyMissingData = matched.filter((c: any) => !c.dataComplete);
    const prodKeep = matched; // already incomplete filtered
    const dropApprovalComplete = matched.filter((c: any) => !(c.dataComplete && c.approvalRequired));

    const liveIds = new Set((body.rows || []).map((r: any) => r.id));
    const score = (ids: string[]) => ({
      total: ids.length,
      missingFromLive: ids.filter((id) => !liveIds.has(id)).length,
      liveMissingFromSet: [...liveIds].filter((id) => !ids.includes(id)).length,
      exact: ids.length === liveIds.size && ids.every((id) => liveIds.has(id)),
    });

    const out = {
      liveHttp: {
        status: res.status,
        serverTiming: headers["server-timing"],
        xPoweredBy: headers["x-powered-by"],
        cacheControl: headers["cache-control"],
        contentLength: headers["content-length"],
        truncated: body.truncated,
        total: body.total,
        rowCount: (body.rows || []).length,
        sampleRowKeys: body.rows?.[0] ? Object.keys(body.rows[0]) : [],
      },
      hypotheses: {
        localFull: score(matched.map((c: any) => c.id)),
        dropTaxInvoiceReceipt: score(noTir.map((c: any) => c.id)),
        onlyDataIncomplete: score(onlyMissingData.map((c: any) => c.id)),
        dropDataCompleteApprovalRequired: score(dropApprovalComplete.map((c: any) => c.id)),
        // drop TIR + drop dataComplete approvalRequired
        dropTirAndApprovalComplete: score(
          matched
            .filter((c: any) => c.documentType !== "tax_invoice_receipt")
            .filter((c: any) => !(c.dataComplete && c.approvalRequired))
            .map((c: any) => c.id),
        ),
        // drop TIR FDR only (keep GSI receipts)
        dropTirFdrOnly: score(
          matched
            .filter(
              (c: any) =>
                !(c.source === "financial_document_review" && c.documentType === "tax_invoice_receipt"),
            )
            .map((c: any) => c.id),
        ),
      },
      localTotal: matched.length,
      scannedMeta: {
        sourceRowsScanned: scanned.sourceRowsScanned,
        waves: scanned.waves,
        truncated: scanned.truncated,
      },
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-hypotheses.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
