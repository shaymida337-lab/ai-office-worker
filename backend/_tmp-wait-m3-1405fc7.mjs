/**
 * Wait until Render backend + frontend deploys for commit 1405fc7 are live.
 * Prints status only (no secrets).
 */
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

const COMMIT = (process.env.VERIFY_COMMIT ?? "1405fc7").slice(0, 7);
const BACKEND = "srv-d898po77f7vs73bu01v0";
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

async function findCommitDeploy(serviceId) {
  const deploys = await listDeploys(serviceId);
  const match = deploys.find((d) => commitPrefix(d) === COMMIT);
  const latest = deploys[0] ?? null;
  return {
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
}

const started = Date.now();
const timeoutMs = 20 * 60 * 1000;

while (Date.now() - started < timeoutMs) {
  const backend = await findCommitDeploy(BACKEND);
  const frontend = await findCommitDeploy(FRONTEND);
  const payload = {
    elapsedSec: Math.round((Date.now() - started) / 1000),
    lookingFor: COMMIT,
    backend: backend.match ?? { waiting: true, latest: backend.latest },
    frontend: frontend.match ?? { waiting: true, latest: frontend.latest },
  };
  console.log(JSON.stringify(payload));

  const be = backend.match;
  const fe = frontend.match;
  if (be && fe && terminal.has(be.status) && terminal.has(fe.status)) {
    const ok = be.status === "live" && fe.status === "live";
    process.exit(ok ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 20000));
}

console.error(JSON.stringify({ error: "timeout waiting for deploys", lookingFor: COMMIT }));
process.exit(2);
