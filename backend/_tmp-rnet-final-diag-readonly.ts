/**
 * READ-ONLY: final Rnet stage probe — pageRows/matched + live API + payload size.
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
  isCompletionDedupeActionable,
  applyCompletionQueueFilters,
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
import { COMPLETION_LIST_MAX_PAYLOAD_BYTES, buildCompletionListPayload } from "./src/services/invoiceCompletion/completionList.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const API = "https://ai-office-worker-backend.onrender.com";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const FDR_ID = "cmqw3n5hx020dm92bp1joi8wu";
const GSI_ID = "cmqw3n5ug020fm92b5smx5bx1";
const FP = "87d30575d372c795d0c93e55fc3d293dcc1f2462a9bad9bf";

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

function slim(c: any) {
  return {
    id: c.id,
    source: c.source,
    reviewStatus: c.reviewStatus,
    rawReviewStatus: c.rawReviewStatus,
    actionable: isCompletionDedupeActionable(c),
    isComplete: c.isComplete,
    dataComplete: c.dataComplete,
    approvalRequired: c.approvalRequired,
    amount: c.amount,
    supplierName: c.supplierName,
    invoiceNumber: c.invoiceNumber,
    decisionReason: String(c.decisionReason || "").slice(0, 140),
    date: c.date,
  };
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
      ...baseWhere,
      gmailScanItemWhere: mergePrismaWhere(
        baseWhere.gmailScanItemWhere as any,
        buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
      ),
      financialDocumentReviewWhere: mergePrismaWhere(
        baseWhere.financialDocumentReviewWhere as any,
        buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
      ),
    };

    const fdr = await prisma.financialDocumentReview.findUnique({ where: { id: FDR_ID } });
    const gsi = await prisma.gmailScanItem.findUnique({ where: { id: GSI_ID } });

    // Any other rows with same FP across org (including quarantined)
    const fpFdrs = await prisma.financialDocumentReview.findMany({
      where: { organizationId: ORG, documentFingerprint: FP },
      select: { id: true, reviewStatus: true, uncertaintyReason: true, documentType: true, totalAmount: true },
    });
    const fpGsis = await prisma.gmailScanItem.findMany({
      where: { organizationId: ORG, duplicateKey: FP },
      select: { id: true, reviewStatus: true, decisionReason: true, documentType: true, amount: true },
    });

    const gsiOrderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
    const fdrOrderBy = [
      { documentDate: "desc" as const },
      { createdAt: "desc" as const },
      { id: "desc" as const },
    ];

    const scanned = await scanCompletionQueueFromSources(
      [
        {
          name: "gmail_scan_item",
          load: ({ skip, take }) =>
            prisma.gmailScanItem.findMany({
              where: whereInput.gmailScanItemWhere,
              orderBy: gsiOrderBy,
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
              orderBy: fdrOrderBy,
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

    const matched = scanned.matched || [];
    const rnetMatched = matched.filter(
      (c: any) =>
        String(c.id).includes(FDR_ID) ||
        String(c.id).includes(GSI_ID) ||
        Number(c.amount) === 354 ||
        String(c.invoiceNumber || "").includes("OV255") ||
        String(c.documentFingerprint || c.duplicateKey || "") === FP,
    );

    // Artificial before-dedupe pair (GSI may be outside where)
    const pair = [
      {
        ...mapGmailScanItemToInvoiceCandidate(gsi as any),
        emailMessageId: gsi!.emailMessageId,
        duplicateKey: gsi!.duplicateKey,
        documentFingerprint: gsi!.duplicateKey,
      },
      {
        ...mapDocumentReviewToInvoiceCandidate(fdr as any, ORG),
        emailMessageId: fdr!.emailMessageId,
        documentFingerprint: fdr!.documentFingerprint,
        duplicateKey: fdr!.documentFingerprint,
      },
    ];
    const before = pair.map(slim);
    const afterDedupe = dedupeCompletionCandidatesPreferGsi(pair).map(slim);
    const afterIncomplete = applyCompletionQueueFilters(dedupeCompletionCandidatesPreferGsi(pair) as any).map(slim);

    const payload = buildCompletionListPayload(scanned.pageRows as any, {
      page: scanned.page,
      pageSize: scanned.pageSize,
      total: scanned.total,
      hasMore: scanned.hasMore,
    });
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");

    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };
    const bust = Date.now();
    const health = await (await fetch(`${API}/api/health?t=${bust}`)).json();
    const live = await (
      await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&_=${bust}`, { headers })
    ).json();
    const searchOv = await (
      await fetch(
        `${API}/api/invoice-completion/list?page=1&pageSize=50&search=${encodeURIComponent("OV255006399")}&_=${bust}`,
        { headers },
      )
    ).json();

    const liveIds = new Set((live.rows || []).map((r: any) => r.id));
    const localOnly = matched.map((c: any) => c.id).filter((id: string) => !liveIds.has(id));
    const liveOnly = [...liveIds].filter((id) => !matched.some((c: any) => c.id === id));

    const out = {
      deploy: { commit: health.commit, buildTime: health.buildTime, serverStartedAt: health.serverStartedAt },
      dbPair: {
        fdrStatus: fdr?.reviewStatus,
        gsiStatus: gsi?.reviewStatus,
        fpFdrs,
        fpGsis,
      },
      fingerprintTrace: {
        candidatesBeforeDedupe: before,
        winner: afterDedupe,
        afterIncompleteFilter: afterIncomplete,
      },
      localCleanScan: {
        total: scanned.total,
        matchedCount: matched.length,
        rnetInMatched: rnetMatched.map(slim),
        payloadBytes,
        payloadLimit: COMPLETION_LIST_MAX_PAYLOAD_BYTES,
        payloadOverLimit: payloadBytes > COMPLETION_LIST_MAX_PAYLOAD_BYTES,
      },
      liveApi: {
        total: live.total,
        hasRnet: [...liveIds].some((id) => id.includes(FDR_ID) || id.includes(GSI_ID)),
        searchOvTotal: searchOv.total,
        searchOvRows: searchOv.rows || [],
        localOnlyIds: localOnly,
        liveOnlyIds: liveOnly,
      },
      stage:
        afterIncomplete.length === 0
          ? "incomplete_filter"
          : rnetMatched.length === 0
            ? "local_scan_drops_unexpected"
            : (live.total ?? 0) < scanned.total && localOnly.includes(`document-review:${FDR_ID}`)
              ? "LIVE_DROPS_AFTER_LOCAL_KEEPS — runtime/filter drift vs clean b46450e simulation"
              : "present",
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-final-diag.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
