/**
 * READ-ONLY: prod-accurate Rnet trace (manual prod isComplete formula) + live API.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import {
  dedupeCompletionCandidatesPreferGsi,
  isCompletionDedupeActionable,
  applyCompletionQueueFilters,
  paginateFilteredCompletionCandidates,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
} from "./src/services/p0/financialReadIsolation.ts";
import { isConfidentlyNotFinancialDocument } from "./src/services/classification/financialDocumentClassification.ts";
import {
  invoiceCandidateToFinancialInput,
  assessInvoiceCompleteness,
} from "./src/services/amount/invoiceCompleteness.ts";

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

/** b46450e formula — do not use local WIP isComplete=dataComplete. */
function applyProdIsCompleteFormula<T extends { dataComplete: boolean; approvalRequired: boolean; isComplete: boolean }>(
  c: T,
): T {
  return {
    ...c,
    isComplete: c.dataComplete && !c.approvalRequired,
  };
}

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const { mapDocumentReviewToInvoiceCandidate, mapGmailScanItemToInvoiceCandidate } = await import(
      "./src/routes/api.ts"
    );
    const fdr = await prisma.financialDocumentReview.findUnique({ where: { id: FDR_ID } });
    const gsi = await prisma.gmailScanItem.findUnique({ where: { id: GSI_ID } });
    if (!fdr || !gsi) throw new Error("missing");

    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const fdrVisible = await prisma.financialDocumentReview.findFirst({
      where: {
        AND: [
          {
            id: FDR_ID,
            organizationId: ORG,
            documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
            reviewStatus: { in: ["needs_review", "rejected", "approved", "auto_saved"] },
          },
          buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated),
        ],
      },
      select: { id: true, reviewStatus: true, uncertaintyReason: true },
    });
    const gsiVisible = await prisma.gmailScanItem.findFirst({
      where: {
        AND: [
          {
            id: GSI_ID,
            organizationId: ORG,
            documentType: { in: ["invoice", "receipt", "unknown_needs_review"] },
            reviewStatus: { in: ["needs_review", "rejected", "approved", "auto_saved"] },
          },
          buildGmailScanItemReadIsolationWhere(ORG, contaminated),
        ],
      },
      select: { id: true, reviewStatus: true, decisionReason: true },
    });

    const fdrMapped = applyProdIsCompleteFormula(mapDocumentReviewToInvoiceCandidate(fdr as any, ORG));
    const gsiMapped = applyProdIsCompleteFormula(mapGmailScanItemToInvoiceCandidate(gsi as any, ORG));

    // Also reassess dataComplete from committed-compatible assess, then apply prod isComplete
    const fdrRe = applyProdIsCompleteFormula({
      ...fdrMapped,
      ...(() => {
        const a = assessInvoiceCompleteness({
          supplierName: fdrMapped.supplierName,
          amount: fdrMapped.amount,
          amountResolved: fdrMapped.amountResolved,
          currency: fdrMapped.currency,
          currencyExplicit: fdrMapped.currencyExplicit,
          date: fdrMapped.date,
          documentDateExplicit: fdrMapped.documentDateExplicit,
          documentType: fdrMapped.documentType,
          reviewStatus: fdrMapped.reviewStatus,
          rawReviewStatus: fdrMapped.rawReviewStatus,
          confidenceScore: fdrMapped.confidenceScore,
          decisionReason: fdrMapped.decisionReason,
          parsedFieldsJson: fdrMapped.parsedFieldsJson,
        });
        return {
          dataComplete: a.dataComplete,
          approvalRequired: a.approvalRequired,
          isComplete: a.isComplete, // will be overwritten by applyProd
          missingDataReasons: a.missingDataReasons,
        };
      })(),
    });
    // Force prod formula again after spreading WIP assessment
    fdrRe.isComplete = fdrRe.dataComplete && !fdrRe.approvalRequired;

    const gsiRe = applyProdIsCompleteFormula({
      ...gsiMapped,
      ...(() => {
        const a = assessInvoiceCompleteness({
          supplierName: gsiMapped.supplierName,
          amount: gsiMapped.amount,
          amountResolved: gsiMapped.amountResolved,
          currency: gsiMapped.currency,
          currencyExplicit: gsiMapped.currencyExplicit,
          date: gsiMapped.date,
          documentDateExplicit: gsiMapped.documentDateExplicit,
          documentType: gsiMapped.documentType,
          reviewStatus: gsiMapped.reviewStatus,
          rawReviewStatus: gsiMapped.rawReviewStatus,
          confidenceScore: gsiMapped.confidenceScore,
          decisionReason: gsiMapped.decisionReason,
          parsedFieldsJson: gsiMapped.parsedFieldsJson,
        });
        return {
          dataComplete: a.dataComplete,
          approvalRequired: a.approvalRequired,
          isComplete: a.isComplete,
          missingDataReasons: a.missingDataReasons,
        };
      })(),
    });
    gsiRe.isComplete = gsiRe.dataComplete && !gsiRe.approvalRequired;

    const candidates = [
      {
        ...gsiRe,
        emailMessageId: gsi.emailMessageId,
        duplicateKey: gsi.duplicateKey,
        documentFingerprint: gsi.duplicateKey,
      },
      {
        ...fdrRe,
        emailMessageId: fdr.emailMessageId,
        documentFingerprint: fdr.documentFingerprint,
        duplicateKey: fdr.documentFingerprint,
      },
    ];

    const slim = (c: any) => ({
      id: c.id,
      source: c.source,
      reviewStatus: c.reviewStatus,
      rawReviewStatus: c.rawReviewStatus,
      decisionReason: String(c.decisionReason || "").slice(0, 140),
      actionable: isCompletionDedupeActionable(c),
      isComplete: c.isComplete,
      dataComplete: c.dataComplete,
      approvalRequired: c.approvalRequired,
      missingDataReasons: c.missingDataReasons,
    });

    const before = candidates.map(slim);
    const deduped = dedupeCompletionCandidatesPreferGsi(candidates);
    const afterIncomplete = applyCompletionQueueFilters(deduped as any);
    const page = paginateFilteredCompletionCandidates(deduped as any, { page: 1, pageSize: 100 });

    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" };

    const live = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const searchOv = await (
      await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&search=${encodeURIComponent("OV255006399")}`, {
        headers,
      })
    ).json();
    const searchErnt = await (
      await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&search=${encodeURIComponent("ערנט")}`, {
        headers,
      })
    ).json();

    // How many FDR needs_review would be incomplete under prod formula?
    const allFdr = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
        reviewStatus: "needs_review",
      },
      select: {
        id: true,
        supplierName: true,
        totalAmount: true,
        currency: true,
        documentType: true,
        documentDate: true,
        normalizedDocumentDate: true,
        reviewStatus: true,
        uncertaintyReason: true,
        confidenceScore: true,
        parsedFieldsJson: true,
      },
      take: 80,
    });
    let wouldKeep = 0;
    let rnetWouldKeep = false;
    for (const row of allFdr) {
      const mapped = applyProdIsCompleteFormula(mapDocumentReviewToInvoiceCandidate(row as any, ORG));
      // overwrite with prod formula using WIP assess fields then force
      const a = assessInvoiceCompleteness({
        supplierName: mapped.supplierName,
        amount: mapped.amount,
        amountResolved: mapped.amountResolved,
        currency: mapped.currency,
        currencyExplicit: mapped.currencyExplicit,
        date: mapped.date,
        documentDateExplicit: mapped.documentDateExplicit,
        documentType: mapped.documentType,
        reviewStatus: mapped.reviewStatus,
        rawReviewStatus: mapped.rawReviewStatus,
        confidenceScore: mapped.confidenceScore,
        decisionReason: mapped.decisionReason,
        parsedFieldsJson: mapped.parsedFieldsJson,
      });
      const isCompleteProd = a.dataComplete && !a.approvalRequired;
      if (!isCompleteProd) {
        wouldKeep++;
        if (row.id === FDR_ID) rnetWouldKeep = true;
      }
    }

    const out = {
      isolation: {
        contaminatedCount: contaminated.length,
        fdrVisibleAfterIsolation: !!fdrVisible,
        gsiVisibleAfterIsolation: !!gsiVisible,
        note: gsiVisible
          ? "GSI still visible despite quarantine text — check isolation marker matching"
          : "GSI excluded by quarantine read isolation",
      },
      prodPipeline: {
        before,
        afterDedupe: deduped.map(slim),
        afterIncompleteIds: afterIncomplete.map((c: any) => c.id),
        pageTotal: page.total,
        nonFinancial: deduped.map((c) => ({
          id: c.id,
          excluded: isConfidentlyNotFinancialDocument(invoiceCandidateToFinancialInput(c as any)),
        })),
        rnetSurvivesProdIncompleteFilter: afterIncomplete.some((c: any) => String(c.id).includes(FDR_ID)),
      },
      fdrPool: {
        needsReviewCount: allFdr.length,
        wouldKeepAsIncompleteUnderProdFormula: wouldKeep,
        rnetWouldKeep,
      },
      liveApi: {
        total: live.total,
        hitPlain: (live.rows || []).filter((r: any) => Number(r.amount) === 354 || String(r.id || "").includes(FDR_ID)),
        searchOv: { total: searchOv.total, rows: searchOv.rows || [] },
        searchErnt: { total: searchErnt.total, rows: (searchErnt.rows || []).slice(0, 5) },
        sampleIds: (live.rows || []).slice(0, 10).map((r: any) => r.id),
      },
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-prod-accurate-trace.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e), stack: String((e as any)?.stack || "").slice(0, 800) }));
  process.exit(1);
});
