/**
 * Wait for frontend deploy 1784bca, verify old Hero copy gone, and Hero lines = 41/38 from home-metrics.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) {
  console.error("RENDER_API_KEY missing");
  process.exit(1);
}

const COMMIT = "1784bca";
const FRONTEND = "srv-d8992s6gvqtc73boqfp0";
const BACKEND = "srv-d898po77f7vs73bu01v0";
const SITE = process.env.PROD_SITE_URL ?? "https://ai-office-worker.com";
const API = process.env.PROD_API_URL ?? "https://ai-office-worker-backend.onrender.com";
const ORG_ID = "cmpjd7j7e0001bl5tzv049rxb";
const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

type Deploy = {
  id: string;
  status: string;
  commit?: { id?: string; message?: string };
  commitId?: string;
};

async function listDeploys(serviceId: string): Promise<Deploy[]> {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=10`, { headers });
  if (!res.ok) throw new Error(`deploys ${serviceId} ${res.status}`);
  const data = (await res.json()) as Array<{ deploy?: Deploy } & Deploy>;
  return data.map((row) => row.deploy ?? row);
}

function commitPrefix(deploy: Deploy): string {
  return (deploy.commit?.id ?? deploy.commitId ?? "").slice(0, 7);
}

async function waitForLive(serviceId: string, label: string, timeoutMs = 15 * 60 * 1000): Promise<Deploy> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const deploys = await listDeploys(serviceId);
    const match = deploys.find((d) => commitPrefix(d).startsWith(COMMIT));
    console.log(
      JSON.stringify({
        label,
        lookingFor: COMMIT,
        match: match ? { id: match.id, status: match.status, commit: commitPrefix(match) } : null,
        latest: deploys[0]
          ? { status: deploys[0].status, commit: commitPrefix(deploys[0]) }
          : null,
      })
    );
    if (match?.status === "live") return match;
    if (match && ["build_failed", "update_failed", "canceled", "deactivated"].includes(match.status)) {
      throw new Error(`${label} deploy ${match.status}`);
    }
    await new Promise((r) => setTimeout(r, 20000));
  }
  throw new Error(`${label} deploy timeout`);
}

async function verifyFrontendBundle(): Promise<void> {
  const pageRes = await fetch(`${SITE}/dashboard`, { redirect: "follow" });
  const html = await pageRes.text();
  const chunkUrls = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]);
  const unique = [...new Set(chunkUrls)];
  let blob = html;
  for (const path of unique.slice(0, 50)) {
    const res = await fetch(`${SITE}${path}`);
    if (res.ok) blob += `\n${await res.text()}`;
  }

  const hasActivePhrase = blob.includes("מבוטחים פעילים");
  const hasLeadsPhrase = blob.includes("לידים חדשים");
  const hasOldMonthClients = blob.includes("לקוחות חדשים החודש");
  const hasOldInsuredMonth = blob.includes("מבוטחים חדשים החודש");
  // Old template fragments used when Hero still said "נוספו N מבוטחים חדשים החודש"
  const hasOldAddedCopy = /נוספו \$\{[^}]+\} .*חדשים החודש/.test(blob) || blob.includes("חדשים החודש");

  console.log(
    JSON.stringify({
      chunksScanned: unique.length,
      hasActivePhrase,
      hasLeadsPhrase,
      hasOldMonthClients,
      hasOldInsuredMonth,
      hasOldAddedCopy,
    })
  );

  if (!hasActivePhrase || !hasLeadsPhrase) {
    throw new Error("PROD bundle missing new Hero phrases");
  }
  if (hasOldMonthClients || hasOldInsuredMonth) {
    throw new Error("PROD bundle still contains old Hero month copy");
  }
  console.log("OK: frontend bundle has new Hero copy; old month copy gone");
}

async function renderJwtSecret(): Promise<string> {
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`env-vars ${res.status}`);
    const data = (await res.json()) as Array<{
      envVar?: { key?: string; value?: string };
      key?: string;
      value?: string;
      cursor?: string;
    }>;
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found");
}

function heroLinesFromMetrics(metrics: {
  active_clients: number;
  new_clients_this_month: number;
  meetings_today: number;
  open_tasks: number;
}): string[] {
  // Mirrors buildInsuranceHomeOverlay metricLabelLine + summaryMetricIds order
  const active =
    metrics.active_clients === 0
      ? "אין מבוטחים פעילים"
      : `יש ${metrics.active_clients} מבוטחים פעילים`;
  const leads =
    metrics.new_clients_this_month === 0
      ? "אין לידים חדשים"
      : `יש ${metrics.new_clients_this_month} לידים חדשים`;
  const meetings =
    metrics.meetings_today === 0
      ? "אין פגישות היום"
      : `יש ${metrics.meetings_today} פגישות היום`;
  const tasks =
    metrics.open_tasks === 0 ? "אין משימות פתוחות" : `יש ${metrics.open_tasks} משימות פתוחות`;
  return [active, leads, meetings, tasks];
}

async function verifyHeroFromHomeMetrics(): Promise<void> {
  const prodUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  if (!prodUrl) throw new Error("PROD_DATABASE_URL missing");
  if (!/localhost|127\.0\.0\.1/.test(prodUrl) && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
    throw new Error("Set ALLOW_REMOTE_READONLY_REPORT=1");
  }
  const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });
  try {
    const org = await prisma.organization.findUnique({
      where: { id: ORG_ID },
      select: { id: true, user: { select: { id: true, email: true } } },
    });
    if (!org) throw new Error("org not found");
    const token = jwt.sign(
      { userId: org.user.id, organizationId: org.id, email: org.user.email },
      await renderJwtSecret(),
      { expiresIn: "10m" }
    );
    const homeRes = await fetch(`${API}/api/dashboard/home-metrics`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!homeRes.ok) throw new Error(`home-metrics ${homeRes.status}`);
    const home = (await homeRes.json()) as {
      metrics: {
        active_clients: number;
        new_clients_this_month: number;
        meetings_today: number;
        open_tasks: number;
      };
    };

    const summaryLines = heroLinesFromMetrics(home.metrics);
    const ok =
      home.metrics.active_clients === 41 &&
      home.metrics.new_clients_this_month === 38 &&
      summaryLines[0] === "יש 41 מבוטחים פעילים" &&
      summaryLines[1] === "יש 38 לידים חדשים" &&
      !summaryLines.some((line) => line.includes("החודש"));

    console.log(JSON.stringify({ metrics: home.metrics, summaryLines, ok }, null, 2));
    if (!ok) {
      console.error("STOP: Hero text mismatch");
      process.exit(1);
    }
    console.log("PROD OK: Hero shows 41 מבוטחים פעילים and 38 לידים חדשים");
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const fe = await waitForLive(FRONTEND, "frontend");
  console.log("frontend live", fe.id, commitPrefix(fe));
  await verifyFrontendBundle();
  await verifyHeroFromHomeMetrics();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
