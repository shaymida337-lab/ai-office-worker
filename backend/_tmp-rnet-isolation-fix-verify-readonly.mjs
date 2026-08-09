/**
 * Wait for 64e0e7f, verify kedma completion list shows Rnet FDR (not quarantined GSI).
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const WANT = "64e0e7fa44a187126cd9d2ef7c25c25fc67f285e";
const BEFORE_TOTAL = 22;
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const FDR_ID = "cmqw3n5hx020dm92bp1joi8wu";
const GSI_ID = "cmqw3n5ug020fm92b5smx5bx1";
const QUARANTINE = "Quarantined: cross-org gmail ingestion";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) process.exit(1);

async function getHealth() {
  return (await fetch(`${API}/api/health?t=${Date.now()}`, { cache: "no-store" })).json();
}

async function waitWant(maxMs = 25 * 60 * 1000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < maxMs) {
    const health = await getHealth().catch(() => null);
    const line = `health=${String(health?.commit ?? "").slice(0, 8)}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (health?.commit === WANT && health?.status === "ok") return health;
    await new Promise((r) => setTimeout(r, 12000));
  }
  throw new Error("timeout waiting for deploy");
}

async function loadJwtSecret() {
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
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

function slimRow(r) {
  return {
    id: r.id,
    source: r.source,
    reviewStatus: r.reviewStatus ?? r.status,
    status: r.status,
    invoiceNumber: r.invoiceNumber ?? null,
    supplierName: r.supplierName ?? null,
    decisionReason: r.decisionReason ? String(r.decisionReason).slice(0, 80) : null,
  };
}

const health = await waitWant();
console.log(JSON.stringify({ live: true, commit: health.commit, started: health.serverStartedAt }, null, 2));

const secret = await loadJwtSecret();
const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "15m" });
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

const listRes = await fetch(
  `${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&_=${Date.now()}`,
  { headers, cache: "no-store" },
);
const list = await listRes.json();
const rows = list.rows || list.items || list.candidates || [];

const rnetRows = rows.filter(
  (r) =>
    String(r.id || "").includes(FDR_ID) ||
    String(r.id || "").includes(GSI_ID) ||
    String(r.invoiceNumber || "").toUpperCase() === "OV255006399" ||
    String(r.supplierName || "").toLowerCase().includes("rnet"),
);
const searchRes = await fetch(
  `${API}/api/invoice-completion/list?page=1&pageSize=25&search=${encodeURIComponent("OV255006399")}&_=${Date.now()}`,
  { headers, cache: "no-store" },
);
const search = await searchRes.json();
const searchRows = search.rows || search.items || search.candidates || [];

const bezeq = rows.filter((r) => /bezeq/i.test(String(r.supplierName || "")) || /bezeq/i.test(String(r.invoiceNumber || "")));
const shaykedma = rows.filter(
  (r) => /shaykedma/i.test(String(r.supplierName || "")) || /shaykedma/i.test(String(r.fromEmail || "")),
);

const quarantined = rows.filter(
  (r) =>
    String(r.decisionReason || "").includes(QUARANTINE) ||
    (String(r.reviewStatus || r.status) === "rejected" &&
      String(r.decisionReason || "").toLowerCase().includes("quarantine")),
);
const gsiRnetPresent = rows.some((r) => String(r.id || "").includes(GSI_ID) || String(r.id || "") === `gmail-scan:${GSI_ID}`);
const fdrRnet = rows.find((r) => String(r.id || "").includes(FDR_ID));
const otherOrgLeak = rows.filter((r) => r.organizationId && r.organizationId !== ORG);

const invoicesRes = await fetch(`${API}/api/invoices?page=1&pageSize=25&_=${Date.now()}`, {
  headers,
  cache: "no-store",
});
const invoices = await invoicesRes.json();

const out = {
  commit: health.commit,
  deployOk: health.commit === WANT && health.status === "ok",
  beforeTotal: BEFORE_TOTAL,
  afterTotal: list.total,
  listStatus: listRes.status,
  rnetAppeared: Boolean(fdrRnet) || searchRows.some((r) => String(r.id || "").includes(FDR_ID) || String(r.invoiceNumber || "").toUpperCase() === "OV255006399"),
  selectedRnet: fdrRnet ? slimRow(fdrRnet) : searchRows[0] ? slimRow(searchRows[0]) : null,
  rnetRows: rnetRows.map(slimRow),
  searchOv255: {
    total: search.total,
    rows: searchRows.map(slimRow),
  },
  gsiQuarantinedAbsent: !gsiRnetPresent,
  quarantinedInList: quarantined.map(slimRow),
  otherOrgLeakCount: otherOrgLeak.length,
  bezeq: bezeq.map(slimRow),
  shaykedma: shaykedma.map(slimRow),
  invoicesList: {
    status: invoicesRes.status,
    total: invoices.total ?? invoices.count ?? null,
    sampleCount: (invoices.rows || invoices.items || []).length,
  },
};

writeFileSync(join(process.cwd(), "_tmp-rnet-isolation-fix-verify.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
