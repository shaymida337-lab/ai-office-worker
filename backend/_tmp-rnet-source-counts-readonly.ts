/**
 * READ-ONLY: source counts + whether missing GSIs have FDR twins that absorb them.
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

const MISSING_GSI = [
  "cmqxf1a1d0b1njx2dnhziydij",
  "cmqxe7pxm0apdjx2dzymfyan8",
  "cmqxeb3hb0ar5jx2dd6mikakb",
  "cmqxf7tfq0b3hjx2ds3ah1ase",
  "cmqxegqwh0au5jx2dkcm0td92",
  "cmqxeh20k0aubjx2dii9h917x",
  "cmqw3ngay020rm92bu32og3aa",
];

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
    const base = buildInvoiceListWhereInput(ctx);
    const gsiWhere = mergePrismaWhere(
      base.gmailScanItemWhere as any,
      buildGmailScanItemReadIsolationWhere(ORG, contaminated) as any,
    );
    const fdrWhere = mergePrismaWhere(
      base.financialDocumentReviewWhere as any,
      buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
    );

    const counts = {
      gsiRaw: await prisma.gmailScanItem.count({ where: { organizationId: ORG } }),
      gsiBaseWhere: await prisma.gmailScanItem.count({ where: base.gmailScanItemWhere }),
      gsiIsolated: await prisma.gmailScanItem.count({ where: gsiWhere }),
      fdrRaw: await prisma.financialDocumentReview.count({ where: { organizationId: ORG } }),
      fdrBaseWhere: await prisma.financialDocumentReview.count({ where: base.financialDocumentReviewWhere }),
      fdrIsolated: await prisma.financialDocumentReview.count({ where: fdrWhere }),
      fdrTaxInvoiceReceipt: await prisma.financialDocumentReview.count({
        where: { ...base.financialDocumentReviewWhere, documentType: "tax_invoice_receipt" },
      }),
      fdrTaxInvoice: await prisma.financialDocumentReview.count({
        where: { ...base.financialDocumentReviewWhere, documentType: "tax_invoice" },
      }),
    };

    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const live = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const liveDocTypes = (live.rows || []).reduce((acc: any, r: any) => {
      const k = r.documentType || "null";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    const gsiAnalyses = [];
    for (const id of MISSING_GSI) {
      const gsi = await prisma.gmailScanItem.findUnique({ where: { id } });
      if (!gsi) continue;
      const fdrTwins = await prisma.financialDocumentReview.findMany({
        where: {
          organizationId: ORG,
          OR: [
            ...(gsi.duplicateKey ? [{ documentFingerprint: gsi.duplicateKey }] : []),
            ...(gsi.emailMessageId ? [{ emailMessageId: gsi.emailMessageId }] : []),
            ...(gsi.gmailMessageId ? [{ gmailMessageId: gsi.gmailMessageId }] : []),
          ],
        },
        select: {
          id: true,
          reviewStatus: true,
          documentType: true,
          totalAmount: true,
          supplierName: true,
          uncertaintyReason: true,
        },
      });
      const pair = [
        {
          ...mapGmailScanItemToInvoiceCandidate(gsi as any),
          emailMessageId: gsi.emailMessageId,
          duplicateKey: gsi.duplicateKey,
          documentFingerprint: gsi.duplicateKey,
        },
        ...fdrTwins.map((f) =>
          mapDocumentReviewToInvoiceCandidate(
            { ...(f as any), emailMessageId: null, gmailMessageId: null, documentFingerprint: null, currency: "ILS", confidenceScore: 0, sender: null, subject: null, fileName: null, invoiceNumber: null, documentDate: null, dueDate: null, amountBeforeVat: null, vatAmount: null, driveFileUrl: null, supplierTaxId: null, parsedFieldsJson: null, rawAnalysis: null, supplierPaymentId: null, normalizedDocumentDate: null, createdAt: new Date(), updatedAt: new Date(), source: null },
            ORG,
          ),
        ),
      ];
      // Better: load full FDR rows
      const fullFdrs = await prisma.financialDocumentReview.findMany({
        where: { id: { in: fdrTwins.map((f) => f.id) } },
      });
      const pair2 = [
        {
          ...mapGmailScanItemToInvoiceCandidate(gsi as any),
          emailMessageId: gsi.emailMessageId,
          duplicateKey: gsi.duplicateKey,
          documentFingerprint: gsi.duplicateKey,
        },
        ...fullFdrs.map((f) => ({
          ...mapDocumentReviewToInvoiceCandidate(f as any, ORG),
          emailMessageId: f.emailMessageId,
          documentFingerprint: f.documentFingerprint,
          duplicateKey: f.documentFingerprint,
        })),
      ];
      const winner = dedupeCompletionCandidatesPreferGsi(pair2);
      const after = applyCompletionQueueFilters(winner as any);
      gsiAnalyses.push({
        gsiId: id,
        gsiStatus: gsi.reviewStatus,
        gsiType: gsi.documentType,
        gsiAmount: gsi.amount,
        gsiSupplier: gsi.supplierName,
        twins: fdrTwins,
        winnerIds: winner.map((w) => w.id),
        afterIncompleteIds: after.map((w) => w.id),
        winnerIsComplete: winner.map((w) => ({ id: w.id, isComplete: w.isComplete, dataComplete: w.dataComplete })),
      });
    }

    const out = { counts, liveDocTypes, liveTotal: live.total, gsiAnalyses };
    writeFileSync(join(process.cwd(), "_tmp-rnet-source-counts.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
