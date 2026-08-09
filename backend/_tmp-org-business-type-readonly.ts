/**
 * Read-only: org businessType via DB + GET /api/organization/settings with Render JWT.
 * Does not print secrets.
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

const API = "https://ai-office-worker-backend.onrender.com";
const BACKEND_SERVICE = "srv-d898po77f7vs73bu01v0";
const ORG_ID = "cmpjd7j7e0001bl5tzv049rxb";

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
      businessType: true,
      enabledModules: true,
      user: { select: { id: true, email: true } },
    },
  });
  if (!org) throw new Error("org not found");

  const secret = await renderJwtSecret();
  const token = jwt.sign(
    { userId: org.user.id, organizationId: org.id, email: org.user.email },
    secret,
    { expiresIn: "10m" }
  );

  const res = await fetch(`${API}/api/organization/settings`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  console.log(
    JSON.stringify(
      {
        orgId: org.id,
        dbBusinessType: org.businessType,
        apiStatus: res.status,
        apiBusinessType: body?.businessType ?? null,
        apiHasBusinessType: body != null && "businessType" in body,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
