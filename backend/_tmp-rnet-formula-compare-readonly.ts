/**
 * READ-ONLY: compare incomplete totals under prod vs WIP formula; list which rows differ.
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
  applyCompletionQueueFilters,
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

function mergePrismaWhere<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown>): T {
  return { AND: [base, extra] } as unknown as T;
}

function applyFormula(candidate: any, mode: "prod" | "wip") {
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
  // assess already returns WIP isComplete=dataComplete locally.
  const isComplete = mode === "prod" ? a.dataComplete && !a.approvalRequired : a.dataComplete;
  return {
    ...candidate,
    dataComplete: a.dataComplete,
    approvalRequired: a.approvalRequired,
    isComplete,
    missingDataReasons: a.missingDataReasons,
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
    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const baseWhere = buildInvoiceListWhereInput(ctx);
    const gsiWhere = mergePrismaWhere(
      baseWhere.gmailScanItemWhere as any,
      buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
    );
    const fdrWhere = mergePrismaWhere(
      baseWhere.financialDocumentReviewWhere as any,
      buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
    );

    const gsiRows = await prisma.gmailScanItem.findMany({
      where: gsiWhere,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: COMPLETION_SCAN_MAX_SOURCE_ROWS,
    });
    const fdrRows = await prisma.financialDocumentReview.findMany({
      where: fdrWhere,
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: COMPLETION_SCAN_MAX_SOURCE_ROWS,
    });

    const base = [
      ...gsiRows.map((row: any) => ({
        ...mapGmailScanItemToInvoiceCandidate(row),
        emailMessageId: row.emailMessageId,
        duplicateKey: row.duplicateKey,
        documentFingerprint: row.duplicateKey,
      })),
      ...fdrRows.map((row: any) => ({
        ...mapDocumentReviewToInvoiceCandidate(row, ORG),
        emailMessageId: row.emailMessageId,
        documentFingerprint: row.documentFingerprint,
        duplicateKey: row.documentFingerprint,
      })),
    ];

    const run = (mode: "prod" | "wip") => {
      const mapped = base.map((c) => applyFormula(c, mode));
      const deduped = dedupeCompletionCandidatesPreferGsi(mapped);
      const incomplete = applyCompletionQueueFilters(deduped as any);
      return {
        before: mapped.length,
        afterDedupe: deduped.length,
        afterIncomplete: incomplete.length,
        ids: incomplete.map((c: any) => c.id).sort(),
        rnet: incomplete.find((c: any) => String(c.id).includes(FDR_ID)) || null,
        rnetSlim: (() => {
          const c = deduped.find((x: any) => String(x.id).includes(FDR_ID));
          if (!c) return null;
          return {
            id: c.id,
            isComplete: c.isComplete,
            dataComplete: c.dataComplete,
            approvalRequired: c.approvalRequired,
            keptInIncomplete: incomplete.some((x: any) => x.id === c.id),
          };
        })(),
      };
    };

    const prod = run("prod");
    const wip = run("wip");
    const onlyInProd = prod.ids.filter((id) => !wip.ids.includes(id));
    const onlyInWip = wip.ids.filter((id) => !prod.ids.includes(id));

    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" };
    const live = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const liveIds = (live.rows || []).map((r: any) => r.id).sort();

    // Fetch all live pages
    const allLiveIds: string[] = [];
    const pages = Math.min(20, Math.max(1, Math.ceil(Number(live.total || 0) / 100)));
    for (let p = 1; p <= pages; p++) {
      const body =
        p === 1
          ? live
          : await (await fetch(`${API}/api/invoice-completion/list?page=${p}&pageSize=100&sort=date_desc`, { headers })).json();
      for (const r of body.rows || []) allLiveIds.push(r.id);
    }
    allLiveIds.sort();

    const out = {
      totals: {
        prodFormulaIncomplete: prod.afterIncomplete,
        wipFormulaIncomplete: wip.afterIncomplete,
        liveApiTotal: live.total,
        liveIdsCollected: allLiveIds.length,
      },
      rnet: {
        underProd: prod.rnetSlim,
        underWip: wip.rnetSlim,
      },
      onlyInProdNotWip: onlyInProd,
      onlyInWipNotProd: onlyInWip,
      liveVsProdMissing: prod.ids.filter((id) => !allLiveIds.includes(id)),
      liveVsWipMissing: wip.ids.filter((id) => !allLiveIds.includes(id)),
      liveExtraVsProd: allLiveIds.filter((id) => !prod.ids.includes(id)),
      liveExtraVsWip: allLiveIds.filter((id) => !wip.ids.includes(id)),
      liveMatchesProd: live.total === prod.afterIncomplete && onlyInProd.every((id) => allLiveIds.includes(id)),
      liveMatchesWip: live.total === wip.afterIncomplete,
      sampleLiveIds: allLiveIds.slice(0, 15),
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-formula-compare.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
