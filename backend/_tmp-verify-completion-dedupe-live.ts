/**
 * READ-ONLY: post-deploy verify completion queue dedupe on prod (kedmashopd1).
 * No writes / no commits.
 */
import { existsSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const WANT = "8aefc6771133d333b2beb2ea8e4b17179f669041";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const renderKey = process.env.RENDER_API_KEY?.trim();

async function loadJwtSecret(): Promise<string | undefined> {
  if (!renderKey) return process.env.JWT_SECRET;
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
      if (key === "JWT_SECRET" && typeof val === "string") return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor || data.length < 100) break;
    url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100&cursor=${cursor}`;
  }
  return process.env.JWT_SECRET;
}

function empty(v: unknown) {
  return v == null || v === "";
}

async function main() {
  const health = await (await fetch(`${API}/api/health`, { headers: { "Cache-Control": "no-cache" } })).json();
  const commit = health.commitSha ?? health.commit ?? null;
  if (commit !== WANT) {
    console.log(JSON.stringify({ ok: false, stage: "deploy", commit, want: WANT }, null, 2));
    process.exit(1);
  }

  const secret = await loadJwtSecret();
  if (!secret) {
    console.log(JSON.stringify({ error: "JWT_SECRET missing" }));
    process.exit(2);
  }
  const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "20m" });
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  };

  const res = await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers });
  const body = await res.json();
  if (!res.ok) {
    console.log(JSON.stringify({ error: "list failed", status: res.status, body }, null, 2));
    process.exit(1);
  }

  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  const slim = (r: any) => ({
    id: r.id,
    source: r.source ?? null,
    supplierName: r.supplierName ?? null,
    amount: r.amount ?? r.totalAmount ?? null,
    gmailMessageId: r.gmailMessageId ?? null,
    emailMessageId: r.emailMessageId ?? null,
    ingestSource: r.ingestSource ?? null,
  });

  const tire = rows.filter((r) => Number(r.amount) === 450 || /general\s*tire/i.test(String(r.supplierName ?? "")));
  const pharm = rows.filter(
    (r) => Number(r.amount) === 918 && (/סופר|פארם|pharm|super/i.test(String(r.supplierName ?? "")) || Number(r.amount) === 918),
  );
  // Prefer name match; if API omits supplierName, amount 918 alone is the known Superpharm card.
  const pharmStrict = rows.filter((r) => Number(r.amount) === 918);

  const fdrNoGmail = rows.filter((r) => {
    const id = String(r.id ?? "");
    const src = String(r.source ?? "");
    const isFdr =
      id.startsWith("document-review:") ||
      src.includes("document_review") ||
      src.includes("financial_document") ||
      src === "document_review";
    return isFdr && empty(r.gmailMessageId) && empty(r.emailMessageId);
  });

  const cameraish = rows.filter((r) => {
    const ingest = String(r.ingestSource ?? "").toLowerCase();
    const name = String(r.supplierName ?? "");
    const file = String(r.attachmentFilename ?? r.fileName ?? "");
    return (
      ingest.includes("camera") ||
      /camera/i.test(file) ||
      /camera/i.test(name) ||
      (empty(r.gmailMessageId) &&
        empty(r.emailMessageId) &&
        (String(r.id ?? "").startsWith("document-review:") || String(r.source ?? "").includes("document")))
    );
  });

  const report = {
    checkedAt: new Date().toISOString(),
    deploy: { commit, liveOnTarget: commit === WANT },
    list: {
      status: res.status,
      rowCount: rows.length,
      total: body.total,
      hasMore: body.hasMore,
      uniqueIds: new Set(rows.map((r) => r.id)).size,
      totalEqualsRows: body.total === rows.length,
      uniqueEqualsRows: new Set(rows.map((r) => r.id)).size === rows.length,
    },
    tire: { count: tire.length, rows: tire.map(slim) },
    pharm: { count: pharmStrict.length, rows: pharmStrict.map(slim) },
    fdrWithoutGmailRefs: { count: fdrNoGmail.length, sample: fdrNoGmail.slice(0, 10).map(slim) },
    cameraOrFdrWithoutGmail: { count: cameraish.length, sample: cameraish.slice(0, 10).map(slim) },
    sourceBreakdown: rows.reduce((acc: Record<string, number>, r) => {
      const k = String(r.source ?? "unknown");
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    checks: {
      tireOnce: tire.length === 1,
      pharmOnce: pharmStrict.length === 1,
      tirePreferredGsi:
        tire.length === 1 &&
        (tire[0].source === "gmail_scan_item" || String(tire[0].id).startsWith("gmail-scan:")),
      pharmPreferredGsi:
        pharmStrict.length === 1 &&
        (pharmStrict[0].source === "gmail_scan_item" || String(pharmStrict[0].id).startsWith("gmail-scan:")),
      totalsMatch: body.total === rows.length && new Set(rows.map((r) => r.id)).size === rows.length,
      cameraOrFdrKept: fdrNoGmail.length > 0 || cameraish.length > 0,
    },
  };
  const pass = Object.values(report.checks).every(Boolean);
  console.log(JSON.stringify({ ...report, verdict: pass ? "PASS" : "FAIL" }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
