/**
 * READ-ONLY: are ANY tax_invoice_receipt rows on live completion? FDR source isolation sample.
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
} from "./src/routes/api.ts";
import {
  applyCompletionQueueFilters,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
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
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
    const ctx = buildInvoiceListQueryContext({ organizationId: ORG });
    const base = buildInvoiceListWhereInput(ctx);
    const fdrWhere = mergePrismaWhere(
      base.financialDocumentReviewWhere as any,
      buildFinancialDocumentReviewReadIsolationWhere(ORG, contaminated) as any,
    );

    const receiptFdrs = await prisma.financialDocumentReview.findMany({
      where: { AND: [fdrWhere, { documentType: "tax_invoice_receipt" }] },
      orderBy: [{ documentDate: "desc" }, { id: "desc" }],
    });

    const mapped = receiptFdrs.map((row) => ({
      ...mapDocumentReviewToInvoiceCandidate(row as any, ORG),
      emailMessageId: row.emailMessageId,
      documentFingerprint: row.documentFingerprint,
    }));
    const incomplete = applyCompletionQueueFilters(mapped as any);

    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "20m" });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const live = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const liveTir = (live.rows || []).filter((r: any) => r.documentType === "tax_invoice_receipt");

    // Simulate OLD prefer-GSI with NO isolation (full base where) — does total≈22 and Rnet gone?
    const gsiAll = await prisma.gmailScanItem.findMany({ where: base.gmailScanItemWhere });
    const fdrAll = await prisma.financialDocumentReview.findMany({ where: base.financialDocumentReviewWhere });
    const {
      dedupeCompletionCandidatesPreferGsi,
      mapGmailScanItemToInvoiceCandidate: _m,
    } = await import("./src/services/invoiceCompletion/completionQueueQuery.ts").then(async (q) => ({
      dedupeCompletionCandidatesPreferGsi: q.dedupeCompletionCandidatesPreferGsi,
      mapGmailScanItemToInvoiceCandidate: (await import("./src/routes/api.ts")).mapGmailScanItemToInvoiceCandidate,
    }));
    const { mapGmailScanItemToInvoiceCandidate } = await import("./src/routes/api.ts");

    const noIsoCandidates = [
      ...gsiAll.map((row) => ({
        ...mapGmailScanItemToInvoiceCandidate(row as any),
        emailMessageId: row.emailMessageId,
        duplicateKey: row.duplicateKey,
        documentFingerprint: row.duplicateKey,
      })),
      ...fdrAll.map((row) => ({
        ...mapDocumentReviewToInvoiceCandidate(row as any, ORG),
        emailMessageId: row.emailMessageId,
        documentFingerprint: row.documentFingerprint,
        duplicateKey: row.documentFingerprint,
      })),
    ];

    // Old prefer GSI: within each cluster pick GSI if any
    function oldDedupe(cands: any[]) {
      // Use union by refs then pick GSI
      const parent = cands.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
      const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
      };
      const refs = (c: any) => {
        const out: string[] = [];
        if (c.gmailMessageId) out.push(`gmail:${c.gmailMessageId}`);
        if (c.emailMessageId) out.push(`email:${c.emailMessageId}`);
        const fp = c.documentFingerprint ?? c.duplicateKey;
        if (fp) out.push(`fp:${fp}`);
        return out;
      };
      const refTo = new Map<string, number>();
      for (let i = 0; i < cands.length; i++) {
        for (const r of refs(cands[i])) {
          const prev = refTo.get(r);
          if (prev !== undefined) union(i, prev);
          else refTo.set(r, i);
        }
      }
      const clusters = new Map<number, number[]>();
      for (let i = 0; i < cands.length; i++) {
        const root = find(i);
        const m = clusters.get(root) || [];
        m.push(i);
        clusters.set(root, m);
      }
      const out: any[] = [];
      for (const members of clusters.values()) {
        const items = members.map((i) => cands[i]!);
        const gsi = items.find((x) => x.source === "gmail_scan_item");
        out.push(gsi || items[0]);
      }
      return out;
    }

    const oldNoIso = applyCompletionQueueFilters(oldDedupe(noIsoCandidates) as any);
    const newNoIso = applyCompletionQueueFilters(dedupeCompletionCandidatesPreferGsi(noIsoCandidates) as any);
    const newWithIso = incomplete; // only TIR FDRs above

    // Full iso path already known as 32

    const out = {
      taxInvoiceReceipt: {
        inIsolatedSource: receiptFdrs.length,
        incompleteLocal: incomplete.length,
        incompleteIds: incomplete.map((c: any) => c.id),
        liveTaxInvoiceReceiptRows: liveTir,
      },
      simulateNoIsolation: {
        sourceCount: noIsoCandidates.length,
        oldDedupeIncompleteTotal: oldNoIso.length,
        oldHasRnet: oldNoIso.some((c: any) => String(c.id).includes("cmqw3n5hx020dm92bp1joi8wu")),
        oldHasBezeq: oldNoIso.some((c: any) => String(c.id).includes("cmqw3onmp0227m92bemcb1bkm")),
        newDedupeIncompleteTotal: newNoIso.length,
        newHasRnet: newNoIso.some((c: any) => String(c.id).includes("cmqw3n5hx020dm92bp1joi8wu")),
        liveTotal: live.total,
        oldIdsMatchLiveCount: oldNoIso.length === live.total,
        // Compare set overlap
        oldOnly: oldNoIso.map((c: any) => c.id).filter((id: string) => !(live.rows || []).some((r: any) => r.id === id)).slice(0, 20),
        liveOnly: (live.rows || []).map((r: any) => r.id).filter((id: string) => !oldNoIso.some((c: any) => c.id === id)),
      },
    };

    writeFileSync(join(process.cwd(), "_tmp-rnet-old-dedupe-sim.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
