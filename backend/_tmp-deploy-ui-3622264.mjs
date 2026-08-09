import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) {
  console.error("RENDER_API_KEY missing");
  process.exit(1);
}

const FRONTEND = process.env.RENDER_FRONTEND_SERVICE_ID || "srv-d8992s6gvqtc73boqfp0";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const TARGET = process.argv[2] || "3622264";
const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function getService(serviceId) {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(`service ${serviceId} ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function triggerDeploy(serviceId) {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
    method: "POST",
    headers,
    body: JSON.stringify({ clearCache: "clear" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`deploy ${serviceId} ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function latestDeploy(serviceId) {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=1`, { headers });
  const data = await res.json();
  return data?.[0]?.deploy ?? data?.[0] ?? null;
}

async function waitLive(serviceId, label, maxMs = 900000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < maxMs) {
    const d = await latestDeploy(serviceId);
    const status = d?.status ?? "unknown";
    const commit = d?.commit?.id?.slice(0, 8) ?? "?";
    const line = `${label}: ${status} commit=${commit}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (status === "live") {
      if (!String(d?.commit?.id || "").startsWith(TARGET)) {
        throw new Error(`${label} live on unexpected commit=${commit}, expected ${TARGET}`);
      }
      return d;
    }
    if (status === "build_failed" || status === "update_failed" || status === "canceled") {
      throw new Error(`${label} deploy failed: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(`${label} deploy timeout`);
}

const fe = await getService(FRONTEND);
const be = await getService(BACKEND);
console.log(
  JSON.stringify(
    {
      frontend: {
        id: FRONTEND,
        name: fe?.service?.name ?? fe?.name,
        branch: fe?.service?.branch ?? fe?.branch,
        repo: fe?.service?.repo ?? fe?.repo,
      },
      backend: {
        id: BACKEND,
        name: be?.service?.name ?? be?.name,
        branch: be?.service?.branch ?? be?.branch,
        repo: be?.service?.repo ?? be?.repo,
      },
      target: TARGET,
    },
    null,
    2
  )
);

// UI-only change — deploy frontend. Backend autoDeploy not required for this commit.
const frontendDeploy = await triggerDeploy(FRONTEND);
console.log(JSON.stringify({ frontendDeployId: frontendDeploy.id ?? frontendDeploy.deploy?.id }, null, 2));
await waitLive(FRONTEND, "frontend");
console.log(JSON.stringify({ ok: true, commit: TARGET, frontend: FRONTEND }, null, 2));
