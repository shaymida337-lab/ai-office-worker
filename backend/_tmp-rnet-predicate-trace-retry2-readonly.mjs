/**
 * Re-hit list and dump all rnet_completion_trace stages after hit.
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

async function fetchTraces(sinceIso) {
  const end = new Date();
  const all = [];
  let windowEnd = end;
  let pages = 0;
  for (let i = 0; i < 30; i++) {
    pages += 1;
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
        all.push({ ts: e.timestamp, raw: msg.slice(0, 300) });
      }
    }
    const oldest = logs[logs.length - 1]?.timestamp;
    if (!oldest || !payload.hasMore) break;
    windowEnd = new Date(new Date(oldest).getTime() - 1);
  }
  return { all, pages };
}

const health = await (await fetch(`${API}/api/health?t=${Date.now()}`, { cache: "no-store" })).json();
console.log("health", health.commit?.slice(0, 8), health.serverStartedAt);

const secret = await loadJwtSecret();
const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "15m" });
const hitAt = new Date().toISOString();
const listRes = await fetch(
  `${API}/api/invoice-completion/list?page=1&pageSize=25&sort=date_desc&_=${Date.now()}`,
  {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  },
);
const list = await listRes.json();
console.log("list", listRes.status, list.total, "hitAt", hitAt);

await new Promise((r) => setTimeout(r, 40000));
const since = new Date(new Date(hitAt).getTime() - 60_000).toISOString();
let { all, pages } = await fetchTraces(since);
console.log("first pass", { pages, count: all.length, stages: [...new Set(all.map((t) => t.stage))] });

if (!all.some((t) => String(t.stage || "").includes("id-only") || String(t.stage || "").startsWith("A."))) {
  await new Promise((r) => setTimeout(r, 45000));
  ({ all, pages } = await fetchTraces(since));
  console.log("second pass", { pages, count: all.length, stages: [...new Set(all.map((t) => t.stage))] });
}

const predicates = all.filter((t) => {
  const stage = String(t.stage ?? "");
  return (
    stage === "id-only" ||
    stage === "firstFailingPredicate" ||
    /^[A-F]\./.test(stage) ||
    stage.startsWith("E.") ||
    stage === "fdrPredicate"
  );
});

const out = {
  commit: health.commit,
  hitAt,
  listTotal: list.total,
  allStages: [...new Set(all.map((t) => t.stage))],
  predicateCount: predicates.length,
  predicates,
};
writeFileSync(join(process.cwd(), "_tmp-rnet-predicate-trace-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
