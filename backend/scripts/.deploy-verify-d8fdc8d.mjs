import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

const rootDir = process.cwd().endsWith("backend") ? join(process.cwd(), "..") : process.cwd();
const backendDir = join(rootDir, "backend");
config({ path: join(backendDir, ".env") });
if (existsSync(join(backendDir, ".env.prod.local"))) {
  config({ path: join(backendDir, ".env.prod.local"), override: true });
}

const API = "https://ai-office-worker-backend.onrender.com";
const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
const EXPECTED_COMMIT = "89afbf5";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) throw new Error("RENDER_API_KEY missing");

async function fetchRenderEnv(key) {
  let url = `https://api.render.com/v1/services/${SERVICE_ID}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const data = await res.json();
    for (const item of data) {
      const k = item.envVar?.key ?? item.key;
      const v = item.envVar?.value ?? item.value;
      if (k === key) return v ?? "";
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${SERVICE_ID}/env-vars?limit=100&cursor=${cursor}`;
  }
  return "";
}

async function waitForDeploy() {
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys?limit=3`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const data = await res.json();
    const deploy = data[0]?.deploy;
    if (deploy) {
      const commit = deploy.commit?.id?.slice(0, 7) ?? "";
      process.stdout.write(`[deploy] attempt ${i + 1}: status=${deploy.status} commit=${commit}\n`);
      if (deploy.status === "live" && commit.startsWith(EXPECTED_COMMIT)) {
        return deploy;
      }
      if (deploy.status === "build_failed" || deploy.status === "update_failed") {
        throw new Error(`deploy failed: ${deploy.status}`);
      }
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("deploy timeout waiting for live d8fdc8d");
}

const deploy = await waitForDeploy();
const healthRes = await fetch(`${API}/health`);
const health = await healthRes.json();

const env = {
  FINANCIAL_INGESTION_CONTAINMENT: await fetchRenderEnv("FINANCIAL_INGESTION_CONTAINMENT"),
  BLOCK_NEW_REGISTRATIONS: await fetchRenderEnv("BLOCK_NEW_REGISTRATIONS"),
};

const result = {
  pushedCommit: EXPECTED_COMMIT,
  deploy: {
    status: deploy.status,
    commit: deploy.commit?.id?.slice(0, 7),
    finishedAt: deploy.finishedAt,
  },
  health: {
    httpStatus: healthRes.status,
    status: health.status,
    database: health.database,
    commit: health.commit?.slice(0, 7),
    serviceName: health.serviceName,
  },
  env,
  checks: {
    deployLive: deploy.status === "live",
    healthOk: healthRes.status === 200 && health.status === "ok",
    databaseConnected: health.database === "connected",
    commitLive: (health.commit ?? "").startsWith(EXPECTED_COMMIT),
    ingestionBlocked: env.FINANCIAL_INGESTION_CONTAINMENT === "1",
    registrationsBlocked: env.BLOCK_NEW_REGISTRATIONS === "true",
  },
};

console.log(JSON.stringify(result, null, 2));

const allPass = Object.values(result.checks).every(Boolean);
if (!allPass) process.exit(1);
