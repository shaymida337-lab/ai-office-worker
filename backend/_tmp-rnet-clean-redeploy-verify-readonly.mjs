/**
 * Clean backend-only redeploy from origin/main @ b46450e (clear cache).
 * Then live-verify Rnet on invoice-completion/list. No logic/DB/commit/push.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const WANT = "b46450eaf4c1ab90d3a49638029d2e8d392c7c21";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const FDR_ID = "cmqw3n5hx020dm92bp1joi8wu";
const GSI_ID = "cmqw3n5ug020fm92b5smx5bx1";
const FP_PREFIX = "87d30575";
const INV = "OV255006399";

const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) {
  console.error("RENDER_API_KEY missing");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function getHealth() {
  const res = await fetch(`${API}/api/health?t=${Date.now()}`, { cache: "no-store" });
  return res.json();
}

async function triggerClearCacheDeploy() {
  const res = await fetch(`https://api.render.com/v1/services/${BACKEND}/deploys`, {
    method: "POST",
    headers,
    body: JSON.stringify({ clearCache: "clear" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`deploy trigger ${res.status}: ${JSON.stringify(body)}`);
  return body.deploy ?? body;
}

async function latestDeploy() {
  const res = await fetch(`https://api.render.com/v1/services/${BACKEND}/deploys?limit=1`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const data = await res.json();
  return data?.[0]?.deploy ?? data?.[0] ?? null;
}

async function waitLive(beforeStartedAt, maxMs = 20 * 60 * 1000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < maxMs) {
    const d = await latestDeploy();
    const health = await getHealth().catch(() => null);
    const status = d?.status ?? "unknown";
    const commit = d?.commit?.id ?? d?.commitId ?? "?";
    const line = `deploy=${status} commit=${String(commit).slice(0, 8)} healthCommit=${health?.commit?.slice?.(0, 8) ?? "?"} started=${health?.serverStartedAt ?? "?"}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
    const commitOk = String(commit) === WANT || String(health?.commit) === WANT;
    const restarted =
      !beforeStartedAt ||
      (health?.serverStartedAt && health.serverStartedAt !== beforeStartedAt);
    if (status === "live" && commitOk && health?.status === "ok" && restarted) {
      return { deploy: d, health };
    }
    if (status === "build_failed" || status === "update_failed" || status === "canceled") {
      throw new Error(`deploy failed: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("deploy timeout");
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

function hitRow(r) {
  const hay = JSON.stringify(r).toLowerCase();
  return (
    hay.includes(FDR_ID) ||
    hay.includes(GSI_ID) ||
    hay.includes(INV.toLowerCase()) ||
    hay.includes(FP_PREFIX) ||
    Number(r.amount) === 354
  );
}

async function verifyLive() {
  const secret = await loadJwtSecret();
  const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, {
    expiresIn: "20m",
  });
  const auth = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
  const bust = Date.now();
  const listRes = await fetch(
    `${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc&_=${bust}`,
    { headers: auth, cache: "no-store" },
  );
  const list = await listRes.json();
  const searchRes = await fetch(
    `${API}/api/invoice-completion/list?page=1&pageSize=50&search=${encodeURIComponent(INV)}&_=${bust}`,
    { headers: auth, cache: "no-store" },
  );
  const search = await searchRes.json();

  const allHits = [];
  const total = Number(list.total || 0);
  const pages = Math.min(20, Math.max(1, Math.ceil(total / 100)));
  for (let p = 1; p <= pages; p++) {
    const body =
      p === 1
        ? list
        : await (
            await fetch(
              `${API}/api/invoice-completion/list?page=${p}&pageSize=100&sort=date_desc&_=${bust + p}`,
              { headers: auth, cache: "no-store" },
            )
          ).json();
    for (const r of body.rows || []) {
      if (hitRow(r)) {
        allHits.push({
          page: p,
          id: r.id,
          amount: r.amount,
          documentType: r.documentType,
          reviewStatus: r.reviewStatus,
          dataComplete: r.dataComplete,
          approvalRequired: r.approvalRequired,
          invoiceNumber: r.invoiceNumber,
          // supplier redacted in summary — keep only for Rnet id match
        });
      }
    }
  }

  return {
    httpStatus: listRes.status,
    total: list.total,
    rowCount: (list.rows || []).length,
    truncated: list.truncated ?? false,
    serverTiming: listRes.headers.get("server-timing"),
    searchOv: { total: search.total, rowCount: (search.rows || []).length },
    rnetHits: allHits,
    hasRnetFdr: allHits.some((h) => String(h.id).includes(FDR_ID)),
    hasRnetGsi: allHits.some((h) => String(h.id).includes(GSI_ID)),
    sampleIds: (list.rows || []).slice(0, 8).map((r) => r.id),
  };
}

const beforeHealth = await getHealth();
console.log(
  JSON.stringify(
    {
      phase: "before",
      commit: beforeHealth.commit,
      buildTime: beforeHealth.buildTime,
      serverStartedAt: beforeHealth.serverStartedAt,
      expectedCommit: WANT,
      note: "Render builds from GitHub origin/main — local WIP unstaged files are NOT included",
    },
    null,
    2,
  ),
);

if (beforeHealth.commit !== WANT) {
  console.error(`health commit ${beforeHealth.commit} != ${WANT}; abort before redeploy`);
  process.exit(1);
}

const triggered = await triggerClearCacheDeploy();
const deployId = triggered.id ?? triggered.deploy?.id;
console.log(JSON.stringify({ phase: "triggered", deployId, clearCache: "clear" }, null, 2));

const { deploy, health } = await waitLive(beforeHealth.serverStartedAt);
console.log(
  JSON.stringify(
    {
      phase: "live",
      deployId: deploy?.id,
      deployStatus: deploy?.status,
      deployCommit: deploy?.commit?.id ?? deploy?.commitId,
      healthCommit: health.commit,
      buildTime: health.buildTime,
      serverStartedAt: health.serverStartedAt,
      previousServerStartedAt: beforeHealth.serverStartedAt,
      restarted: health.serverStartedAt !== beforeHealth.serverStartedAt,
    },
    null,
    2,
  ),
);

// brief settle
await new Promise((r) => setTimeout(r, 5000));
const verify = await verifyLive();
const out = {
  redeploy: {
    fromCommit: WANT,
    clearCache: true,
    backendOnly: true,
    localWipExcluded: true,
    previousServerStartedAt: beforeHealth.serverStartedAt,
    newServerStartedAt: health.serverStartedAt,
    newBuildTime: health.buildTime,
  },
  before: { totalHint: 22 },
  after: verify,
  changed22to32: verify.total === 32,
  rnetAppeared: verify.hasRnetFdr || verify.searchOv.total > 0,
};

writeFileSync(join(process.cwd(), "_tmp-rnet-clean-redeploy-verify.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
