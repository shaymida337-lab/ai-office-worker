/**
 * READ-ONLY: full live loadCompletionQueuePage path for Rnet fingerprint.
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

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

  try {
    // Import route helpers after env so prisma in modules is ok if any
    const api = await import("./src/routes/api.ts");
    const {
      buildInvoiceListQueryContext,
      buildInvoiceListWhereInput,
      applyFinancialReadIsolationToInvoiceListWhere,
      mapDocumentReviewToInvoiceCandidate,
      mapGmailScanItemToInvoiceCandidate,
    } = api as any;

    const {
      dedupeCompletionCandidatesPreferGsi,
      isCompletionDedupeActionable,
      applyCompletionQueueFilters,
      scanCompletionQueueFromSources,
      COMPLETION_SCAN_CHUNK,
      COMPLETION_SCAN_MAX_SOURCE_ROWS,
    } = await import("./src/services/invoiceCompletion/completionQueueQuery.ts");

    const {
      buildFinancialDocumentReviewReadIsolationWhere,
      buildGmailScanItemReadIsolationWhere,
      loadCrossOrgContaminatedGmailIdsForReads,
    } = await import("./src/services/p0/financialReadIsolation.ts");

    const fdr = await prisma.financialDocumentReview.findUnique({ where: { id: FDR_ID } });
    const gsi = await prisma.gmailScanItem.findUnique({ where: { id: GSI_ID } });

    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();

    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const whereInput = await applyFinancialReadIsolationToInvoiceListWhere(
      {
        ...buildInvoiceListWhereInput(ctx),
        includeApprovedInvoices: false,
        includeApprovedSupplierPayments: false,
        includeReviewCandidates: true,
      },
      ORG,
    );

    // Direct where membership
    const fdrInWhere = await prisma.financialDocumentReview.findFirst({
      where: { AND: [{ id: FDR_ID }, whereInput.financialDocumentReviewWhere] },
      select: { id: true, reviewStatus: true, documentType: true, documentDate: true },
    });
    const gsiInWhere = await prisma.gmailScanItem.findFirst({
      where: { AND: [{ id: GSI_ID }, whereInput.gmailScanItemWhere] },
      select: { id: true, reviewStatus: true, documentType: true },
    });

    // Count FDR source size + rank of Rnet by same orderBy as API
    const fdrOrderBy = [
      { documentDate: "desc" as const },
      { createdAt: "desc" as const },
      { id: "desc" as const },
    ];
    const allFdrIds = await prisma.financialDocumentReview.findMany({
      where: whereInput.financialDocumentReviewWhere,
      orderBy: fdrOrderBy,
      select: { id: true, documentDate: true, supplierName: true, totalAmount: true },
    });
    const fdrRank = allFdrIds.findIndex((r) => r.id === FDR_ID);

    const gsiOrderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
    const allGsiIds = await prisma.gmailScanItem.findMany({
      where: whereInput.gmailScanItemWhere,
      orderBy: gsiOrderBy,
      select: { id: true },
    });
    const gsiRank = allGsiIds.findIndex((r) => r.id === GSI_ID);

    // Map with LOCAL completeness (may be WIP) then force prod formula
    const forceProd = (c: any) => ({
      ...c,
      isComplete: Boolean(c.dataComplete) && !Boolean(c.approvalRequired),
    });

    // Run scan with local mappers but force prod isComplete after map
    const pageResult = await scanCompletionQueueFromSources(
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
          map: (row: any) =>
            forceProd({
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
          map: (row: any) =>
            forceProd({
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

    // Trace only fingerprint cluster from full scanned sources (wave 0 enough if both early)
    const gsiRows = await prisma.gmailScanItem.findMany({
      where: whereInput.gmailScanItemWhere,
      orderBy: gsiOrderBy,
      take: COMPLETION_SCAN_CHUNK,
    });
    const fdrRows = await prisma.financialDocumentReview.findMany({
      where: whereInput.financialDocumentReviewWhere,
      orderBy: fdrOrderBy,
      take: COMPLETION_SCAN_CHUNK,
    });

    const sourceBatch = [
      ...gsiRows.map((row: any) =>
        forceProd({
          ...mapGmailScanItemToInvoiceCandidate(row),
          emailMessageId: row.emailMessageId,
          duplicateKey: row.duplicateKey,
          documentFingerprint: row.duplicateKey,
        }),
      ),
      ...fdrRows.map((row: any) =>
        forceProd({
          ...mapDocumentReviewToInvoiceCandidate(row, ORG),
          emailMessageId: row.emailMessageId,
          documentFingerprint: row.documentFingerprint,
          duplicateKey: row.documentFingerprint,
        }),
      ),
    ];

    const fpCluster = sourceBatch.filter(
      (c: any) =>
        String(c.documentFingerprint || c.duplicateKey || "") === FP ||
        String(c.id || "").includes(FDR_ID) ||
        String(c.id || "").includes(GSI_ID) ||
        Number(c.amount) === 354,
    );

    const slim = (c: any) => ({
      id: c.id,
      source: c.source,
      reviewStatus: c.reviewStatus,
      rawReviewStatus: c.rawReviewStatus,
      decisionReason: String(c.decisionReason || "").slice(0, 160),
      actionable: isCompletionDedupeActionable(c),
      isComplete: c.isComplete,
      dataComplete: c.dataComplete,
      approvalRequired: c.approvalRequired,
      amount: c.amount,
      supplierName: c.supplierName,
      documentFingerprint: c.documentFingerprint || c.duplicateKey,
    });

    const before = fpCluster.map(slim);
    const afterDedupe = dedupeCompletionCandidatesPreferGsi(fpCluster).map(slim);
    const afterIncomplete = applyCompletionQueueFilters(
      dedupeCompletionCandidatesPreferGsi(fpCluster) as any,
    ).map(slim);

    const hitInPage = (pageResult.rows || []).filter(
      (r: any) =>
        String(r.id || "").includes(FDR_ID) ||
        String(r.id || "").includes(GSI_ID) ||
        Number(r.amount) === 354 ||
        String(r.documentFingerprint || r.duplicateKey || "") === FP,
    );

    // Live API
    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" };

    const health = await (await fetch(`${API}/api/health`, { headers: { Accept: "application/json" } })).json();
    const live = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const searchOv = await (
      await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=50&search=${encodeURIComponent("OV255006399")}`, { headers })
    ).json();
    const search354 = await (
      await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=50&search=${encodeURIComponent("354")}`, { headers })
    ).json();

    // Paginate all live pages looking for rnet
    const allLiveHits: any[] = [];
    let page = 1;
    let total = live.total ?? 0;
    let pages = Math.max(1, Math.ceil(total / 100));
    for (; page <= pages && page <= 20; page++) {
      const body =
        page === 1
          ? live
          : await (
              await fetch(`${API}/api/invoice-completion/list?page=${page}&pageSize=100&sort=date_desc`, { headers })
            ).json();
      for (const r of body.rows || []) {
        const hay = JSON.stringify(r).toLowerCase();
        if (
          hay.includes(FDR_ID) ||
          hay.includes(GSI_ID) ||
          hay.includes("ov255") ||
          hay.includes("87d30575") ||
          hay.includes("ערנט") ||
          hay.includes("rnet") ||
          Number(r.amount) === 354
        ) {
          allLiveHits.push({ page, id: r.id, amount: r.amount, supplierName: r.supplierName, status: r.status || r.reviewStatus });
        }
      }
    }

    // Compare: is Rnet in local full scan pageResult?
    const out = {
      db: {
        fdr: fdr
          ? {
              id: fdr.id,
              reviewStatus: fdr.reviewStatus,
              documentType: fdr.documentType,
              supplierName: fdr.supplierName,
              totalAmount: fdr.totalAmount,
              documentDate: fdr.documentDate,
              fingerprint: fdr.documentFingerprint,
              uncertaintyReason: String(fdr.uncertaintyReason || "").slice(0, 200),
            }
          : null,
        gsi: gsi
          ? {
              id: gsi.id,
              reviewStatus: gsi.reviewStatus,
              documentType: gsi.documentType,
              decisionReason: String(gsi.decisionReason || "").slice(0, 200),
              duplicateKey: gsi.duplicateKey,
            }
          : null,
      },
      whereMembership: {
        contaminatedCount: contaminated.length,
        fdrInWhere: !!fdrInWhere,
        gsiInWhere: !!gsiInWhere,
        fdrSourceCount: allFdrIds.length,
        gsiSourceCount: allGsiIds.length,
        fdrRankAmongSource: fdrRank,
        gsiRankAmongSource: gsiRank,
        rnetInFirstFdrChunk: fdrRank >= 0 && fdrRank < COMPLETION_SCAN_CHUNK,
      },
      fingerprintTrace: {
        candidatesBeforeDedupe: before,
        afterDedupe,
        afterIncompleteFilter: afterIncomplete,
        note:
          before.length === 0
            ? "Rnet not in first chunk of either source under live where — check rank"
            : "see stages",
      },
      localFullScan: {
        total: pageResult.total,
        truncated: pageResult.truncated,
        sourceRowsScanned: pageResult.sourceRowsScanned,
        hitInPage: hitInPage.map(slim),
        rnetInTotal: (pageResult.rows || []).some((r: any) => String(r.id).includes(FDR_ID)) || hitInPage.length > 0,
      },
      deploy: {
        healthCommit: health.gitCommit || health.commit || health.version || health,
      },
      liveApi: {
        total: live.total,
        pagesScanned: Math.min(pages, 20),
        allLiveHits,
        searchOv: { total: searchOv.total, n: (searchOv.rows || []).length },
        search354Hits: (search354.rows || [])
          .filter((r: any) => Number(r.amount) === 354)
          .map((r: any) => ({ id: r.id, supplierName: r.supplierName, amount: r.amount })),
      },
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-full-scan-trace.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
