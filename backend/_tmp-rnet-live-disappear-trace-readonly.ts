/**
 * READ-ONLY live Rnet completion disappearance trace for kedmashopd1.
 * No DB writes. Never prints tokens.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import {
  dedupeCompletionCandidatesPreferGsi,
  isCompletionDedupeActionable,
  preferCompletionDedupeCandidate,
  applyCompletionQueueFilters,
  paginateFilteredCompletionCandidates,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
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
const WANT = "b46450eaf4c1ab90d3a49638029d2e8d392c7c21";

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

function slimCand(c: any) {
  return {
    id: c.id,
    source: c.source,
    reviewStatus: c.reviewStatus ?? null,
    status: c.status ?? null,
    rawReviewStatus: c.rawReviewStatus ?? null,
    decisionReason: typeof c.decisionReason === "string" ? c.decisionReason.slice(0, 160) : c.decisionReason ?? null,
    uncertaintyReason: typeof c.uncertaintyReason === "string" ? c.uncertaintyReason.slice(0, 160) : null,
    gmailMessageId: c.gmailMessageId ?? null,
    emailMessageId: c.emailMessageId ?? null,
    documentFingerprint: c.documentFingerprint ?? c.duplicateKey ?? null,
    duplicateKey: c.duplicateKey ?? null,
    amount: c.amount ?? c.totalAmount ?? null,
    supplierName: c.supplierName ?? null,
    invoiceNumber: c.invoiceNumber ?? null,
    documentType: c.documentType ?? null,
    isComplete: c.isComplete ?? null,
    dataComplete: c.dataComplete ?? null,
    approvalRequired: c.approvalRequired ?? null,
    missingDataReasons: c.missingDataReasons ?? null,
    actionable: isCompletionDedupeActionable(c),
  };
}

async function main() {
  const health = await (await fetch(`${API}/api/health`, { headers: { "Cache-Control": "no-cache" } })).json();
  const healthCommit = health.commitSha ?? health.commit ?? null;

  const prodUrl = process.env.PROD_DATABASE_URL ?? "";
  if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
    console.error(JSON.stringify({ error: "need PROD+ALLOW" }));
    process.exit(2);
  }
  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

  try {
    const fdr = await prisma.financialDocumentReview.findUnique({
      where: { id: FDR_ID },
      select: {
        id: true,
        organizationId: true,
        gmailMessageId: true,
        emailMessageId: true,
        supplierName: true,
        invoiceNumber: true,
        totalAmount: true,
        currency: true,
        documentType: true,
        documentDate: true,
        normalizedDocumentDate: true,
        reviewStatus: true,
        uncertaintyReason: true,
        documentFingerprint: true,
        sourceFingerprint: true,
        confidenceScore: true,
        fileName: true,
        sender: true,
        subject: true,
        source: true,
        createdAt: true,
        updatedAt: true,
        parsedFieldsJson: true,
      },
    });
    const gsi = await prisma.gmailScanItem.findUnique({
      where: { id: GSI_ID },
      select: {
        id: true,
        organizationId: true,
        gmailMessageId: true,
        emailMessageId: true,
        supplierName: true,
        amount: true,
        documentType: true,
        reviewStatus: true,
        decisionReason: true,
        duplicateKey: true,
        attachmentFilename: true,
        subject: true,
        sender: true,
        senderEmail: true,
        confidenceScore: true,
        occurredAt: true,
        createdAt: true,
        updatedAt: true,
        rawAnalysis: true,
      },
    });

    // Source-row eligibility (same filters as completion where)
    const fdrInSourceWhere = fdr
      ? await prisma.financialDocumentReview.count({
          where: {
            id: FDR_ID,
            organizationId: ORG,
            documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
            reviewStatus: { in: ["needs_review", "rejected", "approved", "auto_saved"] },
          },
        })
      : 0;
    const gsiInSourceWhere = gsi
      ? await prisma.gmailScanItem.count({
          where: {
            id: GSI_ID,
            organizationId: ORG,
            documentType: { in: ["invoice", "receipt", "unknown_needs_review"] },
            reviewStatus: { in: ["needs_review", "rejected", "approved", "auto_saved"] },
          },
        })
      : 0;

    // Import mappers from api — may pull local WIP completeness. Also compute prod-shape assessment manually.
    const { mapDocumentReviewToInvoiceCandidate, mapGmailScanItemToInvoiceCandidate } = await import(
      "./src/routes/api.ts"
    );

    const fdrMapped = fdr ? mapDocumentReviewToInvoiceCandidate(fdr as any, ORG) : null;
    const gsiMapped = gsi ? mapGmailScanItemToInvoiceCandidate(gsi as any, ORG) : null;

    const beforeDedupe = [
      gsiMapped
        ? {
            ...gsiMapped,
            emailMessageId: gsi!.emailMessageId,
            duplicateKey: gsi!.duplicateKey,
            documentFingerprint: gsi!.duplicateKey,
          }
        : null,
      fdrMapped
        ? {
            ...fdrMapped,
            emailMessageId: fdr!.emailMessageId,
            documentFingerprint: fdr!.documentFingerprint,
            duplicateKey: fdr!.documentFingerprint,
          }
        : null,
    ].filter(Boolean) as any[];

    const beforeSlim = beforeDedupe.map(slimCand);
    const winner =
      beforeDedupe.length === 2
        ? preferCompletionDedupeCandidate(beforeDedupe[0], beforeDedupe[1])
        : beforeDedupe[0] ?? null;
    const afterDedupe = dedupeCompletionCandidatesPreferGsi(beforeDedupe);
    const afterIncomplete = applyCompletionQueueFilters(afterDedupe as any);
    const paged = paginateFilteredCompletionCandidates(afterDedupe as any, {
      page: 1,
      pageSize: 100,
      sort: "date_desc",
    });

    // Prod formula (b46450e / 8aefc67): isComplete = dataComplete && !approvalRequired
    // Local WIP may differ — compute both.
    const prodShapeAssessment = fdr
      ? (() => {
          const approvalRequired =
            fdr.reviewStatus !== "approved" &&
            fdr.reviewStatus !== "auto_saved" &&
            fdr.reviewStatus !== "rejected";
          // Approximate dataComplete from mapped fields
          const local = assessInvoiceCompleteness({
            supplierName: fdr.supplierName,
            amount: fdr.totalAmount,
            amountResolved: true,
            currency: fdr.currency,
            currencyExplicit: Boolean(fdr.currency?.trim()),
            date: fdr.normalizedDocumentDate ?? fdr.documentDate,
            documentDateExplicit: (fdr.normalizedDocumentDate ?? fdr.documentDate) != null,
            documentType: fdr.documentType,
            reviewStatus: fdr.reviewStatus,
            rawReviewStatus: fdr.reviewStatus,
            confidenceScore: fdr.confidenceScore,
            decisionReason: fdr.uncertaintyReason,
            parsedFieldsJson: fdr.parsedFieldsJson,
          });
          return {
            localWorkingTree: {
              dataComplete: local.dataComplete,
              approvalRequired: local.approvalRequired,
              isComplete: local.isComplete,
              missingDataReasons: local.missingDataReasons,
              note: "uses currently loaded invoiceCompleteness.ts (may be dirty WIP)",
            },
            prodCommittedFormula: {
              dataComplete: local.dataComplete,
              approvalRequired,
              isComplete: local.dataComplete && !approvalRequired,
              wouldPassIncompleteFilter: !(local.dataComplete && !approvalRequired),
              note: "isComplete = dataComplete && !approvalRequired (b46450e)",
            },
          };
        })()
      : null;

    // LIVE API
    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Cache-Control": "no-cache",
    };

    const listRes = await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers });
    const listBody = await listRes.json();
    const rows = Array.isArray(listBody.rows) ? listBody.rows : [];
    const hit = rows.filter(
      (r: any) =>
        String(r.id || "").includes(FDR_ID) ||
        String(r.id || "").includes(GSI_ID) ||
        String(r.reviewSourceId || "") === FDR_ID ||
        String(r.reviewSourceId || "") === GSI_ID ||
        Number(r.amount) === 354 ||
        /OV255006399|ערנט|rnet/i.test(`${r.supplierName || ""} ${r.invoiceNumber || ""} ${r.decisionReason || ""}`),
    );

    // Also search all pages if hasMore
    let allRows = [...rows];
    let page = 2;
    let hasMore = listBody.hasMore === true;
    while (hasMore && page <= 10) {
      const more = await (
        await fetch(`${API}/api/invoice-completion/list?page=${page}&pageSize=100&sort=date_desc`, { headers })
      ).json();
      const moreRows = Array.isArray(more.rows) ? more.rows : [];
      allRows.push(...moreRows);
      hasMore = more.hasMore === true && moreRows.length > 0;
      page += 1;
    }
    const hitAll = allRows.filter(
      (r: any) =>
        String(r.id || "").includes(FDR_ID) ||
        String(r.id || "").includes(GSI_ID) ||
        String(r.reviewSourceId || "") === FDR_ID ||
        String(r.reviewSourceId || "") === GSI_ID ||
        Number(r.amount) === 354 ||
        /OV255006399|ערנט|rnet/i.test(`${r.supplierName || ""} ${r.invoiceNumber || ""}`),
    );

    // invoices list too
    const invInc = await (
      await fetch(`${API}/api/invoices/list?completeness=incomplete&page=1&pageSize=100&sort=date_desc`, { headers })
    ).json();
    const invComp = await (
      await fetch(`${API}/api/invoices/list?completeness=complete&page=1&pageSize=100&sort=date_desc`, { headers })
    ).json();
    const findInv = (body: any) =>
      (body.invoices || body.rows || []).filter(
        (r: any) =>
          String(r.id || "").includes(FDR_ID) ||
          String(r.id || "").includes(GSI_ID) ||
          Number(r.amount) === 354 ||
          /OV255006399|ערנט/i.test(`${r.supplierName || ""} ${r.invoiceNumber || ""}`),
      );

    const out = {
      checkedAt: new Date().toISOString(),
      deploy: { healthCommit, want: WANT, liveOnTarget: healthCommit === WANT },
      db: {
        fdr: fdr
          ? {
              id: fdr.id,
              reviewStatus: fdr.reviewStatus,
              uncertaintyReason: fdr.uncertaintyReason,
              documentType: fdr.documentType,
              documentFingerprint: fdr.documentFingerprint,
              gmailMessageId: fdr.gmailMessageId,
              totalAmount: fdr.totalAmount,
              invoiceNumber: fdr.invoiceNumber,
              supplierName: fdr.supplierName,
              updatedAt: fdr.updatedAt,
            }
          : null,
        gsi: gsi
          ? {
              id: gsi.id,
              reviewStatus: gsi.reviewStatus,
              decisionReason: gsi.decisionReason,
              documentType: gsi.documentType,
              duplicateKey: gsi.duplicateKey,
              gmailMessageId: gsi.gmailMessageId,
              amount: gsi.amount,
              updatedAt: gsi.updatedAt,
            }
          : null,
        fdrInSourceWhereCount: fdrInSourceWhere,
        gsiInSourceWhereCount: gsiInSourceWhere,
      },
      mappedTrace: {
        beforeDedupe: beforeSlim,
        preferWinner: winner ? slimCand(winner) : null,
        afterDedupe: afterDedupe.map(slimCand),
        afterIncompleteFilter: afterIncomplete.map(slimCand),
        paginatedTotal: paged.total,
        paginatedIds: paged.pageRows.map((r: any) => r.id),
      },
      completeness: prodShapeAssessment,
      liveApi: {
        completion: {
          status: listRes.status,
          total: listBody.total,
          pagesFetched: page - 1,
          allRowCount: allRows.length,
          hitsPage1: hit,
          hitsAllPages: hitAll,
        },
        invoicesIncompleteHits: findInv(invInc),
        invoicesCompleteHits: findInv(invComp),
      },
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-live-disappear-trace.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e), stack: String((e as any)?.stack || "").slice(0, 800) }));
  process.exit(1);
});
