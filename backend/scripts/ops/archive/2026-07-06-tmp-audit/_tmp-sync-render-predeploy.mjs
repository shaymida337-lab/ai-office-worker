import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  config({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const apiKey = process.env.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID;
const PRE_DEPLOY =
  "export DIRECT_URL=${DIRECT_URL:-$DATABASE_URL} && cd backend && npx prisma migrate deploy";

if (!apiKey || !serviceId) {
  console.error(JSON.stringify({ error: "RENDER_API_KEY or RENDER_SERVICE_ID missing" }));
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

function pickServiceConfig(service) {
  const d = service.serviceDetails?.envSpecificDetails ?? {};
  return {
    name: service.name,
    branch: service.branch,
    rootDir: service.rootDir ?? "",
    buildCommand: d.buildCommand ?? null,
    startCommand: d.startCommand ?? null,
    preDeployCommand: d.preDeployCommand ?? null,
    healthCheckPath: service.serviceDetails?.healthCheckPath ?? null,
  };
}

async function getService() {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(`getService failed ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function patchPreDeploy() {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      serviceDetails: {
        preDeployCommand: PRE_DEPLOY,
      },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`patch failed ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function triggerDeploy() {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
    method: "POST",
    headers,
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`deploy trigger failed ${res.status}: ${JSON.stringify(body)}`);
  return body.deploy ?? body;
}

async function getDeploy(deployId) {
  const res = await fetch(`https://api.render.com/v1/deploys/${deployId}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(`getDeploy failed ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function waitForDeploy(deployId, timeoutMs = 900_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const deploy = await getDeploy(deployId);
    const status = deploy.status;
    console.log(JSON.stringify({ poll: true, deployId, status, updatedAt: deploy.updatedAt }));
    if (status === "live") return deploy;
    if (["build_failed", "update_failed", "canceled", "deactivated"].includes(status)) {
      throw new Error(`Deploy ended with status ${status}`);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error("Deploy timed out");
}

async function verifyMigrations() {
  const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const pending = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at
       FROM "_prisma_migrations"
       WHERE migration_name = '20260702153000_add_natalie_conversation_session'`
    );
    const table = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public."NatalieConversationSession"')::text AS regclass`
    );
    const count = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total FROM "_prisma_migrations"`
    );
    const latest = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at
       FROM "_prisma_migrations"
       ORDER BY finished_at DESC NULLS LAST
       LIMIT 5`
    );
    return {
      natalieMigrationApplied: Array.isArray(pending) && pending.length > 0,
      natalieTableExists: table?.[0]?.regclass != null,
      totalMigrations: count?.[0]?.total ?? null,
      latestMigrations: latest,
    };
  } finally {
    await prisma.$disconnect();
  }
}

const report = { preDeployFromRenderYaml: PRE_DEPLOY };

report.before = pickServiceConfig(await getService());

if (report.before.preDeployCommand !== PRE_DEPLOY) {
  const patched = await patchPreDeploy();
  report.patchApplied = true;
  report.afterPatch = pickServiceConfig(patched);
} else {
  report.patchApplied = false;
  report.afterPatch = report.before;
}

report.after = pickServiceConfig(await getService());

const deploy = await triggerDeploy();
report.deployTriggered = {
  id: deploy.id,
  status: deploy.status,
  createdAt: deploy.createdAt,
  commitId: deploy.commit?.id ?? null,
};

const finished = await waitForDeploy(deploy.id);
report.deployFinished = {
  id: finished.id,
  status: finished.status,
  finishedAt: finished.finishedAt,
  commitId: finished.commit?.id ?? null,
};

report.migrationVerification = await verifyMigrations();
report.health = await fetch("https://ai-office-worker-backend.onrender.com/health").then(async (r) => ({
  status: r.status,
  body: await r.json().catch(() => null),
}));

console.log(JSON.stringify(report, null, 2));
