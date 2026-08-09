/**
 * Hit list once, then fetch Render logs (ISO timestamps) for rnet_completion_trace.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const OWNER = process.env.RENDER_OWNER_ID || "tea-d86903gg4nts73abte2g";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) process.exit(1);

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

const health = await (await fetch(`${API}/api/health?t=${Date.now()}`)).json();
const secret = await loadJwtSecret();
const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "15m" });
const hitStart = new Date(Date.now() - 60_000);
const listRes = await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&_=${Date.now()}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  cache: "no-store",
});
const list = await listRes.json();
console.log(JSON.stringify({ healthCommit: health.commit, total: list.total, hasRnet: (list.rows||[]).some(r => String(r.id).includes('cmqw3n5hx')) }, null, 2));

await new Promise((r) => setTimeout(r, 12000));

const end = new Date();
const url =
  `https://api.render.com/v1/logs?ownerId=${OWNER}&resource=${BACKEND}` +
  `&limit=100&direction=backward` +
  `&startTime=${encodeURIComponent(hitStart.toISOString())}` +
  `&endTime=${encodeURIComponent(end.toISOString())}`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
});
const payload = await res.json();
const entries = payload.logs ?? [];
const traces = [];
const related = [];
for (const e of entries) {
  const msg = String(e.message ?? "");
  if (msg.includes("rnet_completion_trace")) {
    const idx = msg.indexOf('{"tag":"rnet_completion_trace"');
    try {
      traces.push({ ts: e.timestamp, ...(JSON.parse(idx >= 0 ? msg.slice(idx) : msg)) });
    } catch {
      traces.push({ ts: e.timestamp, raw: msg.slice(0, 500) });
    }
  } else if (/invoice-completion\/list|completion/i.test(msg)) {
    related.push({ ts: e.timestamp, msg: msg.slice(0, 240) });
  }
}

const byStage = {};
for (const t of traces) if (t.stage) byStage[t.stage] = t;

const out = {
  logStatus: res.status,
  entries: entries.length,
  tracesFound: traces.length,
  byStage,
  related: related.slice(0, 20),
  sampleMsgs: entries.slice(0, 10).map((e) => String(e.message ?? "").slice(0, 180)),
};
writeFileSync(join(process.cwd(), "_tmp-rnet-trace-iso-collect.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
