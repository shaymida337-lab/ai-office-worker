/**
 * Wait for commit 00bb2a9 live, hit completion list once, fetch rnet_completion_trace logs.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const WANT = "00bb2a9dc091aa4e7f2a205c7af57544123d9235";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const OWNER = process.env.RENDER_OWNER_ID || "tea-d86903gg4nts73abte2g";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) {
  console.error("RENDER_API_KEY missing");
  process.exit(1);
}

async function getHealth() {
  return (await fetch(`${API}/api/health?t=${Date.now()}`, { cache: "no-store" })).json();
}

async function latestDeploy() {
  const res = await fetch(`https://api.render.com/v1/services/${BACKEND}/deploys?limit=3`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map((r) => r.deploy ?? r);
}

async function waitWant(maxMs = 20 * 60 * 1000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < maxMs) {
    const deploys = await latestDeploy();
    const health = await getHealth().catch(() => null);
    const top = deploys[0];
    const line = `deploy=${top?.status} commit=${String(top?.commit?.id ?? "").slice(0, 8)} health=${String(health?.commit ?? "").slice(0, 8)}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (health?.commit === WANT && health?.status === "ok") {
      // ensure deploy for this commit is live (or auto-deploy finished)
      const matching = deploys.find((d) => d?.commit?.id === WANT);
      if (!matching || matching.status === "live") return { health, deploy: matching ?? top };
    }
    if (top?.commit?.id === WANT && (top.status === "build_failed" || top.status === "update_failed" || top.status === "canceled")) {
      throw new Error(`deploy failed: ${top.status}`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("timeout waiting for 00bb2a9");
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

async function hitList() {
  const secret = await loadJwtSecret();
  const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "15m" });
  const bust = Date.now();
  const res = await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&_=${bust}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" },
    cache: "no-store",
  });
  const body = await res.json();
  return {
    status: res.status,
    total: body.total,
    hasRnet: (body.rows || []).some((r) => String(r.id || "").includes("cmqw3n5hx020dm92bp1joi8wu")),
  };
}

async function fetchTraceLogs(sinceUnix) {
  const end = Math.floor(Date.now() / 1000);
  const start = sinceUnix ?? end - 30 * 60;
  const url =
    `https://api.render.com/v1/logs?ownerId=${OWNER}&resource=${BACKEND}` +
    `&limit=100&direction=backward&startTime=${start}&endTime=${end}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const payload = await res.json();
  const entries = Array.isArray(payload) ? payload : payload.logs ?? payload.data ?? [];
  const traces = [];
  for (const e of entries) {
    const msg = String(e.message ?? e.text ?? e.msg ?? e.log ?? "");
    if (!msg.includes("rnet_completion_trace")) continue;
    // message may be the JSON line itself or prefixed
    const idx = msg.indexOf('{"tag":"rnet_completion_trace"');
    const jsonPart = idx >= 0 ? msg.slice(idx) : msg;
    try {
      traces.push({ ts: e.timestamp ?? e.time ?? null, ...(JSON.parse(jsonPart)) });
    } catch {
      traces.push({ ts: e.timestamp ?? e.time ?? null, raw: msg.slice(0, 500) });
    }
  }
  return { status: res.status, entryCount: entries.length, traces };
}

console.log(JSON.stringify({ phase: "wait", want: WANT }, null, 2));
const { health, deploy } = await waitWant();
console.log(
  JSON.stringify(
    {
      phase: "live",
      commit: health.commit,
      buildTime: health.buildTime,
      serverStartedAt: health.serverStartedAt,
      deployId: deploy?.id,
      deployStatus: deploy?.status,
    },
    null,
    2,
  ),
);

await new Promise((r) => setTimeout(r, 3000));
const hitAt = Math.floor(Date.now() / 1000) - 5;
const list = await hitList();
console.log(JSON.stringify({ phase: "list", ...list }, null, 2));

// allow logs to flush
await new Promise((r) => setTimeout(r, 8000));
let logs = await fetchTraceLogs(hitAt);
if (logs.traces.length === 0) {
  await new Promise((r) => setTimeout(r, 10000));
  logs = await fetchTraceLogs(hitAt - 60);
}

const byStage = {};
for (const t of logs.traces) {
  if (t.stage) byStage[t.stage] = t;
}

const out = {
  commit: health.commit,
  list,
  stagesPresent: Object.keys(byStage),
  byStage,
  disappearsAt:
    !byStage.inSource || byStage.inSource.count === 0
      ? "before_or_at_inSource (not in source rows)"
      : !byStage.afterDedupe || byStage.afterDedupe.count === 0
        ? "afterDedupe"
        : !byStage.afterIncomplete || byStage.afterIncomplete.count === 0
          ? "afterIncomplete"
          : !byStage.finalPageRows || byStage.finalPageRows.count === 0
            ? "finalPageRows/pagination"
            : list.hasRnet
              ? "present_in_response"
              : "after_finalPageRows (mapping/enrichment/response)",
};

writeFileSync(join(process.cwd(), "_tmp-rnet-trace-collect.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
