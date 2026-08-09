/**
 * READ-ONLY: Rnet disappearance stage with real where + prod isComplete formula.
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
} from "./src/services/p0/financialReadIsolation.ts";
import { assessInvoiceCompleteness } from "./src/services/amount/invoiceCompleteness.ts";

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

function mergePrismaWhere<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown>): T {
  return { AND: [base, extra] } as unknown as T;
}

/** Force b46450e formula regardless of local WIP assessInvoiceCompleteness. */
function forceProdCompleteness<T extends Record<string, any>>(candidate: T): T {
  const a = assessInvoiceCompleteness({
    supplierName: candidate.supplierName,
    amount: candidate.amount,
    amountResolved: candidate.amountResolved,
    currency: candidate.currency,
    currencyExplicit: candidate.currencyExplicit,
    date: candidate.date,
    documentDateExplicit: candidate.documentDateExplicit,
    documentType: candidate.documentType,
    reviewStatus: candidate.reviewStatus,
    rawReviewStatus: candidate.rawReviewStatus,
    confidenceScore: candidate.confidenceScore,
    decisionReason: candidate.decisionReason,
    parsedFieldsJson: candidate.parsedFieldsJson,
    ingestSource: candidate.ingestSource,
  });
  // Prod b46450e: isComplete = dataComplete && !approvalRequired
  // Local WIP: isComplete = dataComplete — override to prod.
  const isCompleteProd = a.dataComplete && !a.approvalRequired;
  return {
    ...candidate,
    dataComplete: a.dataComplete,
    approvalRequired: a.approvalRequired,
    isComplete: isCompleteProd,
    missingDataReasons: a.missingDataReasons,
    approvalReasons: a.approvalReasons,
    completionReasons: a.completionReasons,
    _localWipIsComplete: a.isComplete,
  };
}

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
    const fdr = await prisma.financialDocumentReview.findUnique({ where: { id: FDR_ID } });
    const gsi = await prisma.gmailScanItem.findUnique({ where: { id: GSI_ID } });
    if (!fdr || !gsi) throw new Error("missing rows");

    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const baseWhere = buildInvoiceListWhereInput(ctx);
    const whereInput = {
      ...baseWhere,
      includeApprovedInvoices: false,
      includeApprovedSupplierPayments: false,
      includeReviewCandidates: true,
      gmailScanItemWhere: mergePrismaWhere(
        baseWhere.gmailScanItemWhere as any,
        buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
      ),
      financialDocumentReviewWhere: mergePrismaWhere(
        baseWhere.financialDocumentReviewWhere as any,
        buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
      ),
    };

    const fdrInWhere = await prisma.financialDocumentReview.findFirst({
      where: { AND: [{ id: FDR_ID }, whereInput.financialDocumentReviewWhere] },
      select: {
        id: true,
        reviewStatus: true,
        documentType: true,
        supplierPaymentId: true,
        documentDate: true,
        invoiceNumber: true,
      },
    });
    const gsiInWhere = await prisma.gmailScanItem.findFirst({
      where: { AND: [{ id: GSI_ID }, whereInput.gmailScanItemWhere] },
      select: { id: true, reviewStatus: true },
    });

    const fdrOrderBy = [
      { documentDate: "desc" as const },
      { createdAt: "desc" as const },
      { id: "desc" as const },
    ];
    const gsiOrderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];

    const allFdr = await prisma.financialDocumentReview.findMany({
      where: whereInput.financialDocumentReviewWhere,
      orderBy: fdrOrderBy,
      select: { id: true, documentDate: true, supplierName: true, totalAmount: true, reviewStatus: true },
    });
    const allGsi = await prisma.gmailScanItem.findMany({
      where: whereInput.gmailScanItemWhere,
      orderBy: gsiOrderBy,
      select: { id: true },
    });

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
            forceProdCompleteness({
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
            forceProdCompleteness({
              ...mapDocumentReviewToInvoiceCandidate(row, ORG),
              emailMessageId: row.emailMessageId,
              documentFingerprint: row.documentFingerprint,
              duplicateKey: row.documentFingerprint,
            }),
        },
      ],
      {
        page: 1,
        pageSize: 200,
        sort: "date_desc",
        chunk: COMPLETION_SCAN_CHUNK,
        maxSourceRows: COMPLETION_SCAN_MAX_SOURCE_ROWS,
        dedupeCandidates: dedupeCompletionCandidatesPreferGsi,
      },
    );

    // Also: what if we use LOCAL WIP isComplete without force?
    const localWipMapped = mapDocumentReviewToInvoiceCandidate(fdr as any, ORG);
    const prodForced = forceProdCompleteness({
      ...localWipMapped,
      emailMessageId: fdr.emailMessageId,
      documentFingerprint: fdr.documentFingerprint,
      duplicateKey: fdr.documentFingerprint,
    });

    // Cluster with GSI if somehow in source (shouldn't be)
    const cluster = [];
    if (gsiInWhere) {
      cluster.push(
        forceProdCompleteness({
          ...mapGmailScanItemToInvoiceCandidate(gsi as any),
          emailMessageId: gsi.emailMessageId,
          duplicateKey: gsi.duplicateKey,
          documentFingerprint: gsi.duplicateKey,
        }),
      );
    }
    if (fdrInWhere) {
      cluster.push(prodForced);
    }
    // Even if GSI not in where, show artificial pair for actionability
    const artificialPair = [
      forceProdCompleteness({
        ...mapGmailScanItemToInvoiceCandidate(gsi as any),
        emailMessageId: gsi.emailMessageId,
        duplicateKey: gsi.duplicateKey,
        documentFingerprint: gsi.duplicateKey,
      }),
      prodForced,
    ];

    const slim = (c: any) => ({
      id: c.id,
      source: c.source,
      reviewStatus: c.reviewStatus,
      rawReviewStatus: c.rawReviewStatus,
      decisionReason: String(c.decisionReason || "").slice(0, 160),
      actionable: isCompletionDedupeActionable(c),
      isComplete: c.isComplete,
      _localWipIsComplete: c._localWipIsComplete,
      dataComplete: c.dataComplete,
      approvalRequired: c.approvalRequired,
      amount: c.amount,
      supplierName: c.supplierName,
      invoiceNumber: c.invoiceNumber,
    });

    const before = artificialPair.map(slim);
    const winner = dedupeCompletionCandidatesPreferGsi(artificialPair).map(slim);
    const afterIncomplete = applyCompletionQueueFilters(dedupeCompletionCandidatesPreferGsi(artificialPair) as any).map(
      slim,
    );
    const afterIncompleteLocalWip = applyCompletionQueueFilters([
      { ...localWipMapped, documentFingerprint: fdr.documentFingerprint },
    ] as any).map((c: any) => ({
      id: c.id,
      isComplete: c.isComplete,
      kept: true,
    }));

    const hit = (pageResult.rows || []).filter(
      (r: any) =>
        String(r.id || "").includes(FDR_ID) ||
        String(r.id || "").includes("cmqw3n72w") ||
        Number(r.amount) === 354 ||
        String(r.documentFingerprint || "") === FP ||
        String(r.invoiceNumber || "").includes("OV255"),
    );

    // Live
    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" };
    const health = await (await fetch(`${API}/api/health`)).json();
    const live = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const searchOv = await (
      await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=50&search=${encodeURIComponent("OV255006399")}`, {
        headers,
      })
    ).json();
    const invoicesIncomplete = await (
      await fetch(`${API}/api/invoices?completeness=incomplete&pageSize=100`, { headers })
    ).json().catch(() => null);
    const invoicesComplete = await (
      await fetch(`${API}/api/invoices?completeness=complete&pageSize=100&search=${encodeURIComponent("OV255")}`, {
        headers,
      })
    ).json().catch(() => null);

    const liveHits: any[] = [];
    const total = Number(live.total || 0);
    const pages = Math.min(20, Math.max(1, Math.ceil(total / 100)));
    for (let p = 1; p <= pages; p++) {
      const body =
        p === 1
          ? live
          : await (await fetch(`${API}/api/invoice-completion/list?page=${p}&pageSize=100&sort=date_desc`, { headers })).json();
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
          liveHits.push({
            page: p,
            id: r.id,
            amount: r.amount,
            supplierName: r.supplierName,
            status: r.status || r.reviewStatus,
            isComplete: r.isComplete,
          });
        }
      }
    }

    // Supplier payment linked?
    const sp = fdr.supplierPaymentId
      ? await prisma.supplierPayment.findUnique({
          where: { id: fdr.supplierPaymentId },
          select: { id: true, approvalStatus: true, supplierName: true, amount: true, totalAmount: true },
        })
      : await prisma.supplierPayment.findFirst({
          where: { id: "cmqw3n72w020hm92bouojp6wk" },
          select: { id: true, approvalStatus: true, supplierName: true, amount: true, totalAmount: true },
        });

    const out = {
      deploy: {
        health,
        expectedCommit: "b46450eaf4c1ab90d3a49638029d2e8d392c7c21",
      },
      db: {
        fdr: {
          id: fdr.id,
          reviewStatus: fdr.reviewStatus,
          documentType: fdr.documentType,
          supplierName: fdr.supplierName,
          totalAmount: fdr.totalAmount,
          invoiceNumber: fdr.invoiceNumber,
          documentDate: fdr.documentDate,
          fingerprint: fdr.documentFingerprint,
          supplierPaymentId: fdr.supplierPaymentId,
          uncertaintyReason: String(fdr.uncertaintyReason || "").slice(0, 220),
        },
        gsi: {
          id: gsi.id,
          reviewStatus: gsi.reviewStatus,
          documentType: gsi.documentType,
          decisionReason: String(gsi.decisionReason || "").slice(0, 220),
          duplicateKey: gsi.duplicateKey,
        },
        linkedSupplierPayment: sp,
      },
      where: {
        fdrInWhere: !!fdrInWhere,
        gsiInWhere: !!gsiInWhere,
        fdrSourceCount: allFdr.length,
        gsiSourceCount: allGsi.length,
        fdrRank: allFdr.findIndex((r) => r.id === FDR_ID),
        gsiRank: allGsi.findIndex((r) => r.id === GSI_ID),
        reviewCandidateStatuses: (ctx as any).reviewCandidateStatuses,
      },
      completenessCompare: {
        localWipMappedIsComplete: localWipMapped.isComplete,
        localWipApprovalRequired: localWipMapped.approvalRequired,
        localWipDataComplete: localWipMapped.dataComplete,
        prodForcedIsComplete: prodForced.isComplete,
        prodForcedApprovalRequired: prodForced.approvalRequired,
        afterIncompleteLocalWipKept: afterIncompleteLocalWip,
      },
      fingerprintTrace: {
        candidatesBeforeDedupe: before,
        winnerAfterDedupe: winner,
        afterIncompleteFilter: afterIncomplete,
        actualSourceCluster: cluster.map(slim),
      },
      localScanWithProdFormula: {
        total: pageResult.total,
        truncated: (pageResult as any).truncated,
        sourceRowsScanned: (pageResult as any).sourceRowsScanned,
        hitCount: hit.length,
        hits: hit.map(slim),
      },
      liveApi: {
        completionTotal: live.total,
        liveHits,
        searchOv: { total: searchOv.total, rows: searchOv.rows || [] },
        invoicesIncompleteHint: invoicesIncomplete
          ? {
              total: invoicesIncomplete.total ?? invoicesIncomplete.rows?.length,
              hit: (invoicesIncomplete.rows || invoicesIncomplete.invoices || []).filter((r: any) =>
                JSON.stringify(r).toLowerCase().includes("ov255"),
              ),
            }
          : null,
        invoicesCompleteSearch: invoicesComplete
          ? {
              total: invoicesComplete.total ?? invoicesComplete.rows?.length,
              hit: (invoicesComplete.rows || invoicesComplete.invoices || []).filter((r: any) =>
                JSON.stringify(r).toLowerCase().includes("ov255"),
              ),
            }
          : null,
      },
      diagnosis: {
        disappearsAt:
          !fdrInWhere
            ? "source_where_excludes_fdr"
            : gsiInWhere && winner[0]?.id?.includes(GSI_ID)
              ? "dedupe_still_prefers_rejected_gsi"
              : localWipMapped.isComplete && !prodForced.isComplete
                ? "IF_prod_ran_wip_completeness_would_drop_here"
                : afterIncomplete.length === 0
                  ? "incomplete_filter_drops_fdr"
                  : hit.length === 0
                    ? "dropped_during_full_scan_unexpected"
                    : liveHits.length === 0
                      ? "local_scan_keeps_but_live_api_missing — probe deploy/bundle or live filter drift"
                      : "present_on_live",
      },
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-disappear-stage.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
