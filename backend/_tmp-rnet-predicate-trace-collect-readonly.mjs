/**
 * Wait for dbd498d, hit kedma list once, collect FDR predicate probes.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const WANT = "dbd498da3a807f43fa43d9cdf664099417c36c7b";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const OWNER = process.env.RENDER_OWNER_ID || "tea-d86903gg4nts73abte2g";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) process.exit(1);

function isPredicateLog(t) {
  const stage = String(t.stage ?? "");
  return (
    stage === "id-only" ||
    stage === "firstFailingPredicate" ||
    /^[A-F]\./.test(stage) ||
    stage.startsWith("E.")
  );
}

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

async function fetchAllRnetTraces(sinceIso) {
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

const health = await waitWant();
console.log(JSON.stringify({ live: true, commit: health.commit }, null, 2));

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
console.log(JSON.stringify({ hitAt, status: listRes.status, total: list.total }, null, 2));

const since = health.serverStartedAt || new Date(Date.now() - 20 * 60_000).toISOString();
let predicates = [];
for (let attempt = 1; attempt <= 6; attempt++) {
  await new Promise((r) => setTimeout(r, attempt === 1 ? 25000 : 20000));
  const traces = await fetchAllRnetTraces(since);
  predicates = traces.filter(isPredicateLog);
  console.log(
    JSON.stringify(
      {
        attempt,
        predicateCount: predicates.length,
        stages: predicates.map((p) => p.stage),
      },
      null,
      2,
    ),
  );
  if (predicates.some((p) => p.stage === "id-only")) break;
}

const byStage = {};
for (const t of predicates) {
  byStage[t.stage] = t;
}

const out = {
  commit: health.commit,
  hitAt,
  list: { total: list.total },
  table: Object.fromEntries(
    Object.entries(byStage).map(([stage, t]) => [
      stage,
      {
        matched: t.matched ?? null,
        found: t.found ?? null,
        firstFailingPredicate: t.firstFailingPredicate ?? null,
        inMemoryFirstFailing: t.inMemoryFirstFailing ?? null,
        reviewStatus: t.reviewStatus ?? null,
        documentType: t.documentType ?? null,
        source: t.source ?? null,
        orgIdMatches: t.orgIdMatches ?? null,
        hasGmailMessageId: t.hasGmailMessageId ?? null,
        gmailMessageIdInContaminatedList: t.gmailMessageIdInContaminatedList ?? null,
        uncertaintyReasonIsNull: t.uncertaintyReasonIsNull ?? null,
        uncertaintyReasonHasQuarantineMarker: t.uncertaintyReasonHasQuarantineMarker ?? null,
        safeFields: t.safeFields ?? null,
      },
    ]),
  ),
  firstFailingPredicate: byStage.firstFailingPredicate?.firstFailingPredicate ?? null,
};

writeFileSync(join(process.cwd(), "_tmp-rnet-predicate-trace-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
