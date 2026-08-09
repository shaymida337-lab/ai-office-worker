/**
 * Re-hit list on live bcdf6a6 and poll Render logs until raw traces appear.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const WANT = "bcdf6a61b83f046e95b828365c9c48565556b784";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const OWNER = process.env.RENDER_OWNER_ID || "tea-d86903gg4nts73abte2g";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) process.exit(1);

async function getHealth() {
  return (await fetch(`${API}/api/health?t=${Date.now()}`, { cache: "no-store" })).json();
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

async function fetchTraces(sinceIso) {
  const end = new Date();
  const all = [];
  let windowEnd = end;
  for (let i = 0; i < 20; i++) {
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
      if (!msg.includes("rnet_completion_trace")) continue;
      const marker = '{"tag":"rnet_completion_trace"';
      const idx = msg.indexOf(marker);
      try {
        all.push({ ts: e.timestamp, ...(JSON.parse(idx >= 0 ? msg.slice(idx) : msg)) });
      } catch {
        all.push({ ts: e.timestamp, raw: msg.slice(0, 500) });
      }
    }
    const oldest = logs[logs.length - 1]?.timestamp;
    if (!oldest || !payload.hasMore) break;
    windowEnd = new Date(new Date(oldest).getTime() - 1);
  }
  return all;
}

function classify(byStage) {
  const ctx = byStage.requestContext;
  if (ctx && ctx.orgIdMatchesExpected === false) return "D";
  const rawFdr = byStage.rawFdrFindMany;
  const before = byStage.beforeCollected;
  const after = byStage.afterCollected;
  if (!rawFdr || rawFdr.queryExecuted !== true || rawFdr.matchedTargetCount === 0) return "A";
  if ((before?.fdrMappedTargetCount ?? 0) === 0 && rawFdr.matchedTargetCount > 0) return "B";
  if ((after?.targetCount ?? 0) === 0 && (before?.fdrMappedTargetCount ?? 0) > 0) return "C";
  return "unknown_need_manual";
}

const health = await getHealth();
if (health.commit !== WANT) {
  console.error(JSON.stringify({ error: "wrong_commit", got: health.commit }));
  process.exit(2);
}

const secret = await loadJwtSecret();
const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "15m" });
const hitAt = new Date().toISOString();
const listRes = await fetch(
  `${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&_=${Date.now()}`,
  {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  },
);
const list = await listRes.json();
console.log(JSON.stringify({ hitAt, listStatus: listRes.status, total: list.total }, null, 2));

const since = health.serverStartedAt || new Date(Date.now() - 20 * 60_000).toISOString();
let traces = [];
for (let attempt = 1; attempt <= 6; attempt++) {
  await new Promise((r) => setTimeout(r, attempt === 1 ? 25000 : 20000));
  traces = await fetchTraces(since);
  const stages = [...new Set(traces.map((t) => t.stage).filter(Boolean))];
  console.log(JSON.stringify({ attempt, tracesFound: traces.length, stages }, null, 2));
  if (stages.includes("rawFdrFindMany") || stages.includes("requestContext")) break;
}

const byStage = {};
for (const t of traces) {
  if (t.stage) byStage[t.stage] = t;
}

const out = {
  commit: health.commit,
  hitAt,
  list: {
    status: listRes.status,
    total: list.total,
    hasRnet: (list.rows || []).some((r) => String(r.id).includes("cmqw3n5hx020dm92bp1joi8wu")),
  },
  tracesFound: traces.length,
  byStage,
  verdict: classify(byStage),
};

writeFileSync(join(process.cwd(), "_tmp-rnet-raw-source-trace-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
