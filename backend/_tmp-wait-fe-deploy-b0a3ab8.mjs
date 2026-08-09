/** Wait for frontend Render deploy of commit b0a3ab8 to be live. No site fetch. */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) {
  console.error(JSON.stringify({ error: "RENDER_API_KEY missing" }));
  process.exit(1);
}

const COMMIT = (process.env.VERIFY_COMMIT ?? "b0a3ab8").slice(0, 7);
const FRONTEND = "srv-d8992s6gvqtc73boqfp0";
const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
const terminal = new Set(["live", "update_failed", "build_failed", "canceled", "deactivated"]);

async function listDeploys(serviceId) {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=10`, { headers });
  if (!res.ok) throw new Error(`deploys ${serviceId} ${res.status}`);
  const data = await res.json();
  return data.map((row) => row.deploy ?? row);
}

function commitPrefix(deploy) {
  return String(deploy.commit?.id ?? deploy.commitId ?? "").slice(0, 7);
}

const started = Date.now();
const timeoutMs = 20 * 60 * 1000;

while (Date.now() - started < timeoutMs) {
  const deploys = await listDeploys(FRONTEND);
  const match = deploys.find((d) => commitPrefix(d) === COMMIT) ?? null;
  const latest = deploys[0] ?? null;
  const payload = {
    elapsedSec: Math.round((Date.now() - started) / 1000),
    lookingFor: COMMIT,
    match: match
      ? {
          id: match.id,
          status: match.status,
          commit: commitPrefix(match),
          message: String(match.commit?.message ?? "").split("\n")[0],
          finishedAt: match.finishedAt ?? null,
        }
      : null,
    latest: latest
      ? { id: latest.id, status: latest.status, commit: commitPrefix(latest) }
      : null,
  };
  console.log(JSON.stringify(payload));
  if (match && terminal.has(match.status)) {
    process.exit(match.status === "live" ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 20000));
}

console.error(JSON.stringify({ error: "timeout waiting for frontend deploy", lookingFor: COMMIT }));
process.exit(1);
