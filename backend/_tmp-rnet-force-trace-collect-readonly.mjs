/**
 * Wait for 8873151, hit kedma list, collect forced rnet_completion_trace stages.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const WANT = "8873151d2a79ed6f404f9e43855d591e9291d98b";
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

async function waitWant(maxMs = 20 * 60 * 1000) {
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

async function fetchTraces(sinceIso) {
  const end = new Date();
  const all = [];
  let windowEnd = end;
  for (let i = 0; i < 8; i++) {
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
      const idx = msg.indexOf('{"tag":"rnet_completion_trace"');
      try {
        all.push({ ts: e.timestamp, ...(JSON.parse(idx >= 0 ? msg.slice(idx) : msg)) });
      } catch {
        all.push({ ts: e.timestamp, raw: msg.slice(0, 400) });
      }
    }
    const oldest = logs[logs.length - 1]?.timestamp;
    if (!oldest || !payload.hasMore) break;
    windowEnd = new Date(new Date(oldest).getTime() - 1);
  }
  return all;
}

const health = await waitWant();
console.log(JSON.stringify({ live: true, commit: health.commit, started: health.serverStartedAt }, null, 2));
await new Promise((r) => setTimeout(r, 2000));

const secret = await loadJwtSecret();
const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "15m" });
const since = new Date(Date.now() - 30_000).toISOString();
const list = await (
  await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&_=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  })
).json();

await new Promise((r) => setTimeout(r, 15000));
let traces = await fetchTraces(since);
if (traces.length === 0) {
  await new Promise((r) => setTimeout(r, 15000));
  traces = await fetchTraces(new Date(Date.now() - 5 * 60_000).toISOString());
}

const byStage = {};
for (const t of traces) {
  if (t.stage) byStage[t.stage] = t; // last wins
}

const out = {
  commit: health.commit,
  list: {
    total: list.total,
    hasRnet: (list.rows || []).some((r) => String(r.id).includes("cmqw3n5hx020dm92bp1joi8wu")),
  },
  tracesFound: traces.length,
  byStage,
  disappearsAt:
    !byStage.inSource
      ? "no_logs_collected"
      : byStage.inSource.count === 0
        ? "inSource (not present in isolated source rows)"
        : byStage.afterDedupe?.count === 0
          ? "afterDedupe"
          : byStage.afterIncomplete?.count === 0
            ? "afterIncomplete"
            : byStage.finalPageRows?.count === 0
              ? "finalPageRows"
              : list.hasRnet
                ? "present"
                : "after_finalPageRows",
};

writeFileSync(join(process.cwd(), "_tmp-rnet-force-trace-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
