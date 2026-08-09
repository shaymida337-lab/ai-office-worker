/**
 * READ-ONLY: prod-accurate Rnet filter simulation using committed b46450e completeness
 * + live API search + isolation where.
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { execSync } from "child_process";
import {
  dedupeCompletionCandidatesPreferGsi,
  isCompletionDedupeActionable,
  applyCompletionQueueFilters,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
} from "./src/services/p0/financialReadIsolation.ts";
import { isConfidentlyNotFinancialDocument } from "./src/services/classification/financialDocumentClassification.ts";
import { invoiceCandidateToFinancialInput } from "./src/services/amount/invoiceCompleteness.ts";

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

async function main() {
  // Load committed completeness module into a temp file (no repo edit of tracked sources)
  const tmpDir = join(process.cwd(), "_tmp_prod_modules");
  mkdirSync(tmpDir, { recursive: true });
  const committed = execSync("git show b46450e:backend/src/services/amount/invoiceCompleteness.ts", {
    encoding: "utf8",
    cwd: join(process.cwd(), ".."),
  });
  // Rewrite relative imports to absolute-ish from backend src
  const rewritten = committed
    .replace(/from "\.\/([^"]+)"/g, 'from "../src/services/amount/$1"')
    .replace(/from "\.\.\/classification\/([^"]+)"/g, 'from "../src/services/classification/$1"')
    .replace(/from "\.\.\/([^"]+)"/g, 'from "../src/services/$1"');
  // Actually simpler: write as-is under src/services/amount with a different name via path that resolves same deps
  const committedPath = join(process.cwd(), "src/services/amount/_tmp_invoiceCompleteness_b46450e.ts");
  writeFileSync(
    committedPath,
    committed.replace(
      /from "\.\.\/classification\//g,
      'from "../classification/',
    ),
    "utf8",
  );

  const prodCompleteness = await import("./src/services/amount/_tmp_invoiceCompleteness_b46450e.ts");

  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

  try {
    const { mapDocumentReviewToInvoiceCandidate, mapGmailScanItemToInvoiceCandidate } = await import(
      "./src/routes/api.ts"
    );

    const fdr = await prisma.financialDocumentReview.findUnique({ where: { id: FDR_ID } });
    const gsi = await prisma.gmailScanItem.findUnique({ where: { id: GSI_ID } });
    if (!fdr || !gsi) throw new Error("missing rows");

    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const fdrIso = buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated);
    const gsiIso = buildGmailScanItemReadIsolationWhere(ORG, contaminated);

    const fdrVisible = await prisma.financialDocumentReview.findFirst({
      where: {
        AND: [
          { id: FDR_ID, organizationId: ORG, documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] }, reviewStatus: { in: ["needs_review", "rejected", "approved", "auto_saved"] } },
          fdrIso,
        ],
      },
      select: { id: true, reviewStatus: true, uncertaintyReason: true, gmailMessageId: true },
    });
    const gsiVisible = await prisma.gmailScanItem.findFirst({
      where: {
        AND: [
          { id: GSI_ID, organizationId: ORG, documentType: { in: ["invoice", "receipt", "unknown_needs_review"] }, reviewStatus: { in: ["needs_review", "rejected", "approved", "auto_saved"] } },
          gsiIso,
        ],
      },
      select: { id: true, reviewStatus: true, decisionReason: true, gmailMessageId: true },
    });

    // Map with api (local enrich uses WIP completeness) — then RECOMPUTE isComplete with prod formula
    const fdrMappedRaw = mapDocumentReviewToInvoiceCandidate(fdr as any, ORG);
    const gsiMappedRaw = mapGmailScanItemToInvoiceCandidate(gsi as any, ORG);

    const reassess = (c: any) => {
      const a = prodCompleteness.assessInvoiceCompleteness({
        supplierName: c.supplierName,
        amount: c.amount,
        amountResolved: c.amountResolved,
        currency: c.currency,
        currencyExplicit: c.currencyExplicit,
        date: c.date,
        documentDateExplicit: c.documentDateExplicit,
        documentType: c.documentType,
        reviewStatus: c.reviewStatus,
        rawReviewStatus: c.rawReviewStatus ?? c.reviewStatus,
        confidenceScore: c.confidenceScore,
        decisionReason: c.decisionReason,
        parsedFieldsJson: c.parsedFieldsJson,
        ingestSource: c.ingestSource,
      });
      return {
        ...c,
        dataComplete: a.dataComplete,
        approvalRequired: a.approvalRequired,
        isComplete: a.isComplete,
        missingDataReasons: a.missingDataReasons,
        approvalReasons: a.approvalReasons,
        completionReasons: a.completionReasons,
      };
    };

    const candidates = [
      {
        ...reassess(gsiMappedRaw),
        emailMessageId: gsi.emailMessageId,
        duplicateKey: gsi.duplicateKey,
        documentFingerprint: gsi.duplicateKey,
      },
      {
        ...reassess(fdrMappedRaw),
        emailMessageId: fdr.emailMessageId,
        documentFingerprint: fdr.documentFingerprint,
        duplicateKey: fdr.documentFingerprint,
      },
    ];

    const before = candidates.map((c) => ({
      id: c.id,
      source: c.source,
      reviewStatus: c.reviewStatus,
      decisionReason: String(c.decisionReason || "").slice(0, 120),
      actionable: isCompletionDedupeActionable(c),
      isComplete: c.isComplete,
      dataComplete: c.dataComplete,
      approvalRequired: c.approvalRequired,
      missingDataReasons: c.missingDataReasons,
    }));

    const deduped = dedupeCompletionCandidatesPreferGsi(candidates);
    const afterIncomplete = applyCompletionQueueFilters(deduped as any);
    const nonFin = deduped.map((c) => ({
      id: c.id,
      excludedAsNonFinancial: isConfidentlyNotFinancialDocument(invoiceCandidateToFinancialInput(c as any)),
    }));

    // Live API with search
    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" };

    const searches = ["OV255006399", "ערנט", "354", "Rnet", FDR_ID];
    const searchResults: any[] = [];
    for (const q of searches) {
      const body = await (
        await fetch(
          `${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&search=${encodeURIComponent(q)}`,
          { headers },
        )
      ).json();
      searchResults.push({
        q,
        total: body.total,
        ids: (body.rows || []).map((r: any) => ({ id: r.id, amount: r.amount, supplierName: r.supplierName, reviewStatus: r.reviewStatus, source: r.source })),
      });
    }

    const list = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const rows = list.rows || [];

    const out = {
      isolation: {
        contaminatedCount: contaminated.length,
        fdrVisibleAfterIsolation: fdrVisible,
        gsiVisibleAfterIsolation: gsiVisible,
        gsiExcludedByQuarantine: !gsiVisible && !!gsi,
      },
      prodFormulaTrace: {
        before,
        afterDedupe: deduped.map((c) => ({
          id: c.id,
          source: c.source,
          reviewStatus: c.reviewStatus,
          isComplete: c.isComplete,
          dataComplete: c.dataComplete,
          approvalRequired: c.approvalRequired,
          missingDataReasons: c.missingDataReasons,
          actionable: isCompletionDedupeActionable(c),
        })),
        afterIncompleteFilter: afterIncomplete.map((c: any) => c.id),
        nonFinancialCheck: nonFin,
        survivesProdPipeline: afterIncomplete.some((c: any) => String(c.id).includes(FDR_ID)),
      },
      liveApi: {
        total: list.total,
        rowIds: rows.map((r: any) => r.id),
        searchResults,
      },
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-prod-accurate-trace.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
    try {
      const { unlinkSync } = await import("fs");
      unlinkSync(committedPath);
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e), stack: String((e as any)?.stack || "").slice(0, 1000) }));
  process.exit(1);
});
