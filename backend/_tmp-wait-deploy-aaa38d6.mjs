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
const TARGET = (process.argv[2] || "aaa38d6").slice(0, 7);
const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function latestDeploys(serviceId, limit = 5) {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=${limit}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(`deploys ${res.status}: ${JSON.stringify(data)}`);
  return (data || []).map((row) => row.deploy ?? row);
}

async function triggerDeploy(serviceId) {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
    method: "POST",
    headers,
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`deploy ${serviceId} ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function commitOf(d) {
  return String(d?.commit?.id || "").slice(0, 7);
}

const existing = await latestDeploys(FRONTEND, 8);
console.log(
  JSON.stringify(
    {
      target: TARGET,
      recent: existing.map((d) => ({
        id: d.id,
        status: d.status,
        commit: commitOf(d),
        trigger: d.trigger,
      })),
    },
    null,
    2
  )
);

let match = existing.find((d) => commitOf(d).startsWith(TARGET));
if (!match) {
  console.log("No deploy for target yet — triggering frontend deploy");
  await triggerDeploy(FRONTEND);
}

const start = Date.now();
let last = "";
while (Date.now() - start < 900000) {
  const deploys = await latestDeploys(FRONTEND, 8);
  match = deploys.find((d) => commitOf(d).startsWith(TARGET));
  const line = match
    ? `frontend: ${match.status} commit=${commitOf(match)} id=${match.id}`
    : `frontend: waiting for commit=${TARGET}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  if (match?.status === "live") {
    console.log(JSON.stringify({ ok: true, commit: commitOf(match), deployId: match.id, status: match.status }, null, 2));
    process.exit(0);
  }
  if (match && ["build_failed", "update_failed", "canceled"].includes(match.status)) {
    throw new Error(`frontend deploy failed: ${match.status}`);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
throw new Error("frontend deploy timeout");
