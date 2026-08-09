/**
 * Wait for 1529f19, verify Rnet still present and no rnet_completion_trace logs.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const WANT = "1529f19ec0e7cc680b532e93fb191f6759aada4f";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const OWNER = process.env.RENDER_OWNER_ID || "tea-d86903gg4nts73abte2g";
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
  throw new Error("timeout");
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

async function fetchRnetTraces(sinceIso) {
  const end = new Date();
  const all = [];
  let windowEnd = end;
  for (let i = 0; i < 15; i++) {
    const url =
      `https://api.render.com/v1/logs?ownerId=${OWNER}&resource=${BACKEND}` +
      `&limit=100&direction=backward` +
      `&startTime=${encodeURIComponent(sinceIso)}` +
      `&endTime=${encodeURIComponent(windowEnd.toISOString())}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const payload = await res.json();
    const logs = payload.logs ?? [];
    if (!logs.length) break;
    for (const e of logs) {
      const msg = String(e.message ?? "");
      if (msg.includes("rnet_completion_trace")) {
        all.push({ ts: e.timestamp, msg: msg.slice(0, 200) });
      }
    }
    const oldest = logs[logs.length - 1]?.timestamp;
    if (!oldest || !payload.hasMore) break;
    windowEnd = new Date(new Date(oldest).getTime() - 1);
  }
  return all;
}

const health = await waitWant();
console.log(JSON.stringify({ live: true, commit: health.commit }, null, 2));

const secret = await loadJwtSecret();
const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "15m" });
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
const hitAt = new Date().toISOString();

const listRes = await fetch(
  `${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&_=${Date.now()}`,
  { headers, cache: "no-store" },
);
const list = await listRes.json();
const rows = list.rows || [];
const rnet = rows.filter(
  (r) =>
    String(r.id || "").includes(FDR_ID) ||
    String(r.id || "").includes(GSI_ID) ||
    String(r.invoiceNumber || "").toUpperCase() === "OV255006399",
);
const quarantined = rows.filter((r) => String(r.decisionReason || "").includes(QUARANTINE));
const gsiPresent = rows.some((r) => String(r.id || "").includes(GSI_ID));

await new Promise((r) => setTimeout(r, 35000));
let traces = await fetchRnetTraces(hitAt);
if (traces.length > 0) {
  await new Promise((r) => setTimeout(r, 25000));
  traces = await fetchRnetTraces(hitAt);
}

const out = {
  commit: health.commit,
  healthOk: health.status === "ok",
  listStatus: listRes.status,
  total: list.total,
  rnetCount: rnet.length,
  rnetRows: rnet.map((r) => ({
    id: r.id,
    source: r.source,
    status: r.reviewStatus || r.status,
    invoiceNumber: r.invoiceNumber,
  })),
  gsiQuarantinedAbsent: !gsiPresent,
  quarantinedCount: quarantined.length,
  tracesAfterHit: traces.length,
  tracesSample: traces.slice(0, 3),
};

writeFileSync(join(process.cwd(), "_tmp-rnet-diag-removed-verify.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
