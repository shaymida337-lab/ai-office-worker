/**
 * Wait for Render deploys of commit 2638b74 on backend + frontend, then verify CRM/dashboard parity via API.
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

const COMMIT = (process.env.VERIFY_COMMIT ?? "2638b74").slice(0, 7);
const BACKEND = "srv-d898po77f7vs73bu01v0";
const FRONTEND = "srv-d8992s6gvqtc73boqfp0";
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
    const latest = deploys[0];
    console.log(
      JSON.stringify({
        label,
        lookingFor: COMMIT,
        latest: latest
          ? {
              id: latest.id,
              status: latest.status,
              commit: commitPrefix(latest),
              message: latest.commit?.message?.slice(0, 80),
            }
          : null,
        match: match ? { id: match.id, status: match.status, commit: commitPrefix(match) } : null,
      })
    );
    if (match?.status === "live") return match;
    if (match && ["build_failed", "update_failed", "canceled", "deactivated"].includes(match.status)) {
      throw new Error(`${label} deploy ${match.status}`);
    }
    await new Promise((r) => setTimeout(r, 20000));
  }
  throw new Error(`${label} deploy timeout waiting for ${COMMIT}`);
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

async function verifyProd(): Promise<void> {
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
    const secret = await renderJwtSecret();
    const token = jwt.sign(
      { userId: org.user.id, organizationId: org.id, email: org.user.email },
      secret,
      { expiresIn: "10m" }
    );

    const homeRes = await fetch(`${API}/api/dashboard/home-metrics`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!homeRes.ok) {
      throw new Error(`home-metrics ${homeRes.status} ${await homeRes.text()}`);
    }
    const home = (await homeRes.json()) as {
      metrics?: { active_clients?: number; new_clients_this_month?: number };
    };

    const leadsRes = await fetch(`${API}/api/leads`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!leadsRes.ok) {
      throw new Error(`leads ${leadsRes.status} ${await leadsRes.text()}`);
    }
    const leads = (await leadsRes.json()) as {
      kpis?: { activeCustomers?: number; newLeads?: number };
    };

    const crm = {
      activeCustomers: leads.kpis?.activeCustomers,
      newLeads: leads.kpis?.newLeads,
    };
    const dashboard = {
      active_clients: home.metrics?.active_clients,
      new_clients_this_month: home.metrics?.new_clients_this_month,
    };

    const ok =
      crm.activeCustomers === 41 &&
      crm.newLeads === 38 &&
      dashboard.active_clients === 41 &&
      dashboard.new_clients_this_month === 38;

    console.log(JSON.stringify({ crm, dashboard, ok }, null, 2));
    if (!ok) {
      console.error("STOP: prod mismatch — expected CRM=41/38 Dashboard=41/38");
      process.exit(1);
    }
    console.log("PROD OK: CRM=41/38 Dashboard=41/38");
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const backend = await waitForLive(BACKEND, "backend");
  console.log("backend live", backend.id, commitPrefix(backend));
  const frontend = await waitForLive(FRONTEND, "frontend");
  console.log("frontend live", frontend.id, commitPrefix(frontend));
  await verifyProd();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
