/**
 * READ-ONLY: inspect liveVsProdMissing rows vs live-present peers.
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
  COMPLETION_SCAN_MAX_SOURCE_ROWS,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
} from "./src/services/p0/financialReadIsolation.ts";
import {
  assessInvoiceCompleteness,
  shouldExcludeFromInvoiceCompletionQueue,
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

const MISSING = [
  "document-review:cmqw3n5hx020dm92bp1joi8wu",
  "document-review:cmqw3onmp0227m92bemcb1bkm",
  "document-review:cmqxeh4bh0audjx2d6ncvt92u",
  "gmail-scan:cmqw3ngay020rm92bu32og3aa",
  "gmail-scan:cmqxe7pxm0apdjx2dzymfyan8",
  "gmail-scan:cmqxeb3hb0ar5jx2dd6mikakb",
  "gmail-scan:cmqxegqwh0au5jx2dkcm0td92",
  "gmail-scan:cmqxeh20k0aubjx2dii9h917x",
  "gmail-scan:cmqxf1a1d0b1njx2dnhziydij",
  "gmail-scan:cmqxf7tfq0b3hjx2ds3ah1ase",
];

const PRESENT_PEERS = [
  "document-review:cmqxf61ak0b2zjx2dna3832rx",
  "document-review:cmqxf65y40b31jx2d0snodln4",
  "gmail-scan:cmr1vlh4m00rjj42c0eps0k9l",
];

function mergePrismaWhere<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown>): T {
  return { AND: [base, extra] } as unknown as T;
}

function stripPrefix(id: string) {
  if (id.startsWith("document-review:")) return { kind: "fdr" as const, id: id.slice("document-review:".length) };
  if (id.startsWith("gmail-scan:")) return { kind: "gsi" as const, id: id.slice("gmail-scan:".length) };
  return { kind: "unknown" as const, id };
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

    async function describe(listId: string) {
      const p = stripPrefix(listId);
      let mapped: any = null;
      let db: any = null;
      let inWhere = false;
      if (p.kind === "fdr") {
        db = await prisma.financialDocumentReview.findUnique({ where: { id: p.id } });
        inWhere = !!(await prisma.financialDocumentReview.findFirst({
          where: { AND: [{ id: p.id }, fdrWhere] },
          select: { id: true },
        }));
        if (db) {
          mapped = {
            ...mapDocumentReviewToInvoiceCandidate(db, ORG),
            emailMessageId: db.emailMessageId,
            documentFingerprint: db.documentFingerprint,
            duplicateKey: db.documentFingerprint,
          };
        }
      } else if (p.kind === "gsi") {
        db = await prisma.gmailScanItem.findUnique({ where: { id: p.id } });
        inWhere = !!(await prisma.gmailScanItem.findFirst({
          where: { AND: [{ id: p.id }, gsiWhere] },
          select: { id: true },
        }));
        if (db) {
          mapped = {
            ...mapGmailScanItemToInvoiceCandidate(db),
            emailMessageId: db.emailMessageId,
            duplicateKey: db.duplicateKey,
            documentFingerprint: db.duplicateKey,
          };
        }
      }
      if (!mapped) return { listId, missingDb: true };
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
        ingestSource: mapped.ingestSource,
      });
      return {
        listId,
        inWhere,
        source: mapped.source,
        reviewStatus: mapped.reviewStatus,
        rawReviewStatus: mapped.rawReviewStatus,
        actionable: isCompletionDedupeActionable(mapped),
        amount: mapped.amount,
        supplierName: mapped.supplierName,
        invoiceNumber: mapped.invoiceNumber,
        documentType: mapped.documentType,
        decisionReason: String(mapped.decisionReason || "").slice(0, 160),
        isComplete: a.isComplete,
        dataComplete: a.dataComplete,
        approvalRequired: a.approvalRequired,
        missingDataReasons: a.missingDataReasons,
        approvalReasons: a.approvalReasons,
        nonFinancialExcluded: shouldExcludeFromInvoiceCompletionQueue(mapped),
        gmailMessageId: mapped.gmailMessageId,
        emailMessageId: mapped.emailMessageId,
        fingerprint: mapped.documentFingerprint ?? mapped.duplicateKey,
        dbReviewStatus: db?.reviewStatus,
        dbDecisionOrUncertainty: String(db?.decisionReason || db?.uncertaintyReason || "").slice(0, 160),
      };
    }

    const missing = [];
    for (const id of MISSING) missing.push(await describe(id));
    const present = [];
    for (const id of PRESENT_PEERS) present.push(await describe(id));

    // Live rows sample fields for one present incomplete
    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const live = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const liveById = Object.fromEntries((live.rows || []).map((r: any) => [r.id, r]));

    // Check invoices complete list for Rnet (maybe routed there on live?)
    const invComplete = await (
      await fetch(`${API}/api/invoices?completeness=complete&pageSize=100&search=${encodeURIComponent("OV255006399")}`, {
        headers,
      })
    ).json().catch((e) => ({ error: String(e) }));
    const invIncomplete = await (
      await fetch(`${API}/api/invoices?completeness=incomplete&pageSize=100&search=${encodeURIComponent("OV255006399")}`, {
        headers,
      })
    ).json().catch((e) => ({ error: String(e) }));
    const invAll = await (
      await fetch(`${API}/api/invoices?completeness=all&pageSize=100&search=${encodeURIComponent("OV255006399")}`, {
        headers,
      })
    ).json().catch((e) => ({ error: String(e) }));

    // Common patterns among missing
    const pattern = {
      allApprovalRequired: missing.every((m: any) => m.approvalRequired),
      allDataComplete: missing.every((m: any) => m.dataComplete),
      allIsCompleteFalse: missing.every((m: any) => m.isComplete === false),
      anyNonFinancial: missing.filter((m: any) => m.nonFinancialExcluded).map((m: any) => m.listId),
      anyNotInWhere: missing.filter((m: any) => !m.inWhere).map((m: any) => m.listId),
      decisionReasonTokens: missing.map((m: any) => ({
        id: m.listId,
        hasBlocked: /blocked/i.test(m.decisionReason || ""),
        hasQuarantine: /quarantin/i.test(m.decisionReason || ""),
        hasDup: /duplicate/i.test(m.decisionReason || ""),
      })),
    };

    const out = {
      pattern,
      missing,
      presentPeers: present.map((p: any) => ({
        ...p,
        onLive: !!liveById[p.listId],
        liveRow: liveById[p.listId]
          ? {
              id: liveById[p.listId].id,
              amount: liveById[p.listId].amount,
              status: liveById[p.listId].status,
              isComplete: liveById[p.listId].isComplete,
              approvalRequired: liveById[p.listId].approvalRequired,
              dataComplete: liveById[p.listId].dataComplete,
            }
          : null,
      })),
      liveRoutingSearchOv: {
        complete: invComplete,
        incomplete: invIncomplete,
        all: invAll,
      },
      liveTotal: live.total,
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-missing-pattern.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
