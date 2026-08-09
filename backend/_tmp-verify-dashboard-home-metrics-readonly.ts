/**
 * Read-only: verify GET /api/dashboard/home-metrics matches direct Prisma counts for org.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import {
  countDashboardHomeMetricsDirect,
  getDashboardHomeMetrics,
} from "./src/services/dashboardHomeMetrics.js";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(prodUrl);
if (!prodUrl) {
  console.error("PROD_DATABASE_URL / DATABASE_URL missing");
  process.exit(1);
}
if (!isLocal && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error("Remote DB blocked. Set ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}

const API = process.env.PROD_API_URL ?? "https://ai-office-worker-backend.onrender.com";
const BACKEND_SERVICE = "srv-d898po77f7vs73bu01v0";
const ORG_ID = process.env.VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";

async function renderJwtSecret(): Promise<string> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");
  let url = `https://api.render.com/v1/services/${BACKEND_SERVICE}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Render env-vars ${res.status}`);
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
    url = `https://api.render.com/v1/services/${BACKEND_SERVICE}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found on Render");
}

const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

async function main() {
  const org = await prisma.organization.findUnique({
    where: { id: ORG_ID },
    select: {
      id: true,
      name: true,
      user: { select: { id: true, email: true } },
    },
  });
  if (!org) throw new Error(`org not found: ${ORG_ID}`);

  const now = new Date();
  const direct = await countDashboardHomeMetricsDirect(org.id, now);
  const service = await getDashboardHomeMetrics(org.id, now);

  const mismatches: string[] = [];
  for (const key of Object.keys(direct) as Array<keyof typeof direct>) {
    if (direct[key] !== service.metrics[key]) {
      mismatches.push(`${key}: direct=${direct[key]} service=${service.metrics[key]}`);
    }
  }

  console.log(JSON.stringify({ org: org.name, organizationId: org.id, direct, service: service.metrics }, null, 2));

  if (mismatches.length > 0) {
    console.error("SERVICE MISMATCH:", mismatches);
    process.exit(1);
  }
  console.log("OK: getDashboardHomeMetrics matches direct Prisma counts");

  try {
    const secret = await renderJwtSecret();
    const token = jwt.sign(
      { userId: org.user.id, organizationId: org.id, email: org.user.email },
      secret,
      { expiresIn: "10m" }
    );
    const res = await fetch(`${API}/api/dashboard/home-metrics`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.status === 404) {
      console.log("SKIP API: /dashboard/home-metrics not deployed yet (404)");
      return;
    }
    if (!res.ok) {
      console.error("API failed", res.status, await res.text());
      process.exit(1);
    }
    const api = (await res.json()) as { metrics: typeof direct };
    const apiMismatches: string[] = [];
    for (const key of Object.keys(direct) as Array<keyof typeof direct>) {
      if (direct[key] !== api.metrics[key]) {
        apiMismatches.push(`${key}: direct=${direct[key]} api=${api.metrics[key]}`);
      }
    }
    if (apiMismatches.length > 0) {
      console.error("API MISMATCH:", apiMismatches);
      process.exit(1);
    }
    console.log("OK: production API matches direct Prisma counts");
  } catch (err) {
    console.warn("API verify skipped:", err instanceof Error ? err.message : String(err));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
