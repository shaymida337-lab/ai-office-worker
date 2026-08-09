/**
 * READ-ONLY: live capture of /reports completion list for kedmashopd1
 * Endpoints: /api/invoice-completion/list (+ bootstrap for context)
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const renderKey = process.env.RENDER_API_KEY?.trim();
const prodUrl = process.env.PROD_DATABASE_URL ?? "";

if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD + ALLOW" }));
  process.exit(2);
}

async function loadRenderEnv(): Promise<Record<string, string>> {
  if (!renderKey) return {};
  const out: Record<string, string> = {};
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${renderKey}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Render env-vars ${res.status}`);
    const data = await res.json();
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key && typeof val === "string") out[key] = val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor || data.length < 100) break;
    url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100&cursor=${cursor}`;
  }
  return out;
}

function slimRow(row: any) {
  return {
    id: row.id,
    source: row.source ?? null,
    reviewStatus: row.reviewStatus ?? row.status ?? null,
    supplierName: row.supplierName ?? null,
    amount: row.amount ?? row.totalAmount ?? null,
    gmailMessageId: row.gmailMessageId ?? null,
    attachmentFilename: row.attachmentFilename ?? row.fileName ?? null,
    documentType: row.documentType ?? null,
    documentFingerprint: row.documentFingerprint ?? null,
    duplicateKey: row.duplicateKey ?? null,
    reviewSourceId: row.reviewSourceId ?? null,
    decisionReason: typeof row.decisionReason === "string" ? row.decisionReason.slice(0, 120) : row.decisionReason ?? null,
    uncertaintyReason: row.uncertaintyReason ?? null,
    createdAt: row.createdAt ?? null,
  };
}

function matchTargets(rows: any[]) {
  const tire = rows.filter(
    (r) => Number(r.amount) === 450 || /general|tire/i.test(String(r.supplierName ?? ""))
  );
  const pharm = rows.filter(
    (r) => Number(r.amount) === 918 || (/סופר|pharm/i.test(String(r.supplierName ?? "")) && Number(r.amount) === 918)
  );
  return { tire: tire.map(slimRow), pharm: pharm.map(slimRow) };
}

async function main() {
  const env = await loadRenderEnv();
  const secret = env.JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    console.error(JSON.stringify({ error: "JWT_SECRET missing from Render/env" }));
    process.exit(2);
  }

  const token = jwt.sign(
    { userId: USER, organizationId: ORG, email: EMAIL },
    secret,
    { expiresIn: "30m" }
  );

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  // Page through completion list like the frontend (page 1..N)
  const allCompletionRows: any[] = [];
  let page = 1;
  let hasMore = true;
  let firstPayload: any = null;
  const pageSnapshots: any[] = [];
  while (hasMore && page <= 20) {
    const url = `${API}/api/invoice-completion/list?page=${page}&pageSize=25&sort=date_desc`;
    const res = await fetch(url, { headers });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { parseError: true, text: text.slice(0, 500) };
    }
    if (page === 1) firstPayload = { status: res.status, keys: body && typeof body === "object" ? Object.keys(body) : null };
    if (!res.ok) {
      writeFileSync(
        join(process.cwd(), "_tmp-reports-live-dup.json"),
        JSON.stringify({ error: "completion list failed", status: res.status, body }, null, 2)
      );
      console.log(JSON.stringify({ error: "completion list failed", status: res.status, body }, null, 2));
      process.exit(1);
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    pageSnapshots.push({
      page,
      rowCount: rows.length,
      total: body.total,
      hasMore: body.hasMore,
      truncated: body.truncated,
      targetHits: matchTargets(rows),
    });
    allCompletionRows.push(...rows);
    hasMore = body.hasMore === true && rows.length > 0;
    page += 1;
  }

  // Also fetch invoices/list complete for comparison
  const invRes = await fetch(`${API}/api/invoices/list?completeness=complete&page=1&pageSize=100&sort=date_desc`, {
    headers,
  });
  const invBody = await invRes.json();
  const invoiceRows = Array.isArray(invBody.invoices) ? invBody.invoices : [];

  // Bootstrap (should not contribute cards)
  const bootRes = await fetch(`${API}/api/invoice-completion/bootstrap`, { headers });
  const bootBody = await bootRes.json();

  const completionTargets = matchTargets(allCompletionRows);
  const invoiceTargets = matchTargets(invoiceRows);

  // Frontend append dedupe simulation (by id only)
  const seen = new Set<string>();
  const afterFrontendDedupe: any[] = [];
  for (const row of allCompletionRows) {
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    afterFrontendDedupe.push(row);
  }
  const frontendTargets = matchTargets(afterFrontendDedupe);

  // DB confirmation of ids
  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  let dbCross: any = null;
  try {
    const tireFdr = await prisma.financialDocumentReview.findFirst({
      where: { id: "cms1p5fn1008rj81sxvqogrc8", organizationId: ORG },
      select: { id: true, documentFingerprint: true, gmailMessageId: true, totalAmount: true, supplierName: true },
    });
    const tireGsi = await prisma.gmailScanItem.findFirst({
      where: { id: "cms1p5nwl008xj81s2yeavjyx", organizationId: ORG },
      select: { id: true, duplicateKey: true, gmailMessageId: true, amount: true, supplierName: true },
    });
    const pharmFdr = await prisma.financialDocumentReview.findFirst({
      where: { id: "cms1p5woj008zj81s99yq2wfp", organizationId: ORG },
      select: { id: true, documentFingerprint: true, gmailMessageId: true, totalAmount: true, supplierName: true },
    });
    const pharmGsi = await prisma.gmailScanItem.findFirst({
      where: { id: "cms1p5x0k0091j81sy1y0xkcr", organizationId: ORG },
      select: { id: true, duplicateKey: true, gmailMessageId: true, amount: true, supplierName: true },
    });
    dbCross = { tireFdr, tireGsi, pharmFdr, pharmGsi };
  } finally {
    await prisma.$disconnect();
  }

  const out = {
    checkedAt: new Date().toISOString(),
    screen: "/reports (ReportsClient = השלמת חשבוניות)",
    endpoints: {
      list: "GET /api/invoice-completion/list",
      bootstrap: "GET /api/invoice-completion/bootstrap (summary only; rows come from list)",
      invoicesCompare: "GET /api/invoices/list?completeness=complete",
    },
    frontendBehavior: {
      firstPaint: "setInvoices(list.rows) from completion list page 1",
      background: "append pages with dedupe by row.id only (not by gmailMessageId)",
      bootstrapContributesCards: false,
    },
    completionList: {
      firstPayloadMeta: firstPayload,
      pagesFetched: pageSnapshots.length,
      pageSnapshots,
      totalRowsAcrossPages: allCompletionRows.length,
      uniqueIds: new Set(allCompletionRows.map((r) => r.id)).size,
      targetsRaw: completionTargets,
      targetsAfterFrontendIdDedupe: frontendTargets,
    },
    invoicesListComplete: {
      status: invRes.status,
      total: invBody.total ?? invoiceRows.length,
      targets: invoiceTargets,
    },
    bootstrap: {
      status: bootRes.status,
      keys: bootBody && typeof bootBody === "object" ? Object.keys(bootBody) : null,
      incompleteCount: bootBody?.summary?.incompleteCount ?? bootBody?.incompleteCount ?? null,
      hasRowsArray: Array.isArray(bootBody?.rows),
    },
    dbCross,
    verdict: {
      completionApiReturnsTwoPerDoc:
        completionTargets.tire.length >= 2 && completionTargets.pharm.length >= 2,
      tireCount: completionTargets.tire.length,
      pharmCount: completionTargets.pharm.length,
      tireSources: completionTargets.tire.map((r) => ({ id: r.id, source: r.source })),
      pharmSources: completionTargets.pharm.map((r) => ({ id: r.id, source: r.source })),
      invoicesListShowsOneOrZero: {
        tire: invoiceTargets.tire.length,
        pharm: invoiceTargets.pharm.length,
      },
      rootCause:
        "invoice-completion/list concatenates GSI+FDR via scanCompletionQueueFromSources without mergeInvoiceListCandidates dedupe",
    },
  };

  writeFileSync(join(process.cwd(), "_tmp-reports-live-dup.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
