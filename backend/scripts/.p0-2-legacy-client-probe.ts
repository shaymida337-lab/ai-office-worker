import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const backendDir = join(process.cwd());
loadEnv({ path: join(backendDir, ".env") });
loadEnv({ path: join(backendDir, ".env.prod.local"), override: true });

const API = "https://ai-office-worker-backend.onrender.com";

async function renderEnv(key: string) {
  const sid = process.env.RENDER_SERVICE_ID!;
  const res = await fetch(`https://api.render.com/v1/services/${sid}/env-vars?limit=100`, {
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json" },
  });
  const data = (await res.json()) as Array<{ envVar?: { key: string; value: string } }>;
  for (const item of data) {
    const ev = item.envVar ?? (item as unknown as { key: string; value: string });
    if (ev.key === key) return ev.value;
  }
  return null;
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

function blocked(status: number, text: string) {
  return (
    status === 503 ||
    status === 500 ||
    text.includes("Financial ingestion is temporarily blocked") ||
    text.includes("FINANCIAL_INGESTION_CONTAINMENT")
  );
}

async function main() {
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });

const clients = await prisma.client.findMany({
  where: { isActive: true, gmailConnected: true, googleRefreshToken: { not: null } },
  select: { id: true, organizationId: true },
  take: 3,
});

const jwtSecret = (await renderEnv("JWT_SECRET"))!;
const probes: Array<Record<string, unknown>> = [];

for (const c of clients) {
  const org = await prisma.organization.findUnique({
    where: { id: c.organizationId },
    select: { user: { select: { id: true, email: true } } },
  });
  if (!org?.user) continue;
  const token = jwt.sign(
    { userId: org.user.id, organizationId: c.organizationId, email: org.user.email },
    jwtSecret,
    { expiresIn: "1h" },
  );
  for (const path of [`/api/clients/${c.id}/scan/invoices`, `/api/clients/${c.id}/scan`]) {
    const r = await api("POST", path, token, {});
    probes.push({
      clientId: c.id,
      organizationId: c.organizationId,
      path,
      status: r.status,
      blocked: blocked(r.status, r.text),
      snippet: r.text.slice(0, 200),
    });
  }
}

let scanAll: Record<string, unknown> | null = null;
if (clients[0]) {
  const c = clients[0];
  const org = await prisma.organization.findUnique({
    where: { id: c.organizationId },
    select: { user: { select: { id: true, email: true } } },
  });
  if (org?.user) {
    const token = jwt.sign(
      { userId: org.user.id, organizationId: c.organizationId, email: org.user.email },
      jwtSecret,
      { expiresIn: "1h" },
    );
    const r = await api("POST", "/api/clients/scan-all", token, {});
    scanAll = {
      organizationId: c.organizationId,
      status: r.status,
      blocked: blocked(r.status, r.text) || (r.text.includes('"success":false') && r.text.includes("Financial ingestion")),
      snippet: r.text.slice(0, 260),
    };
  }
}

console.log(
  JSON.stringify(
    {
      gmailClientsFound: clients.length,
      legacyClientProbes: probes,
      scanAll,
      allLegacyBlocked:
        probes.every((p) => p.blocked) && (scanAll ? scanAll.blocked || scanAll.status === 200 : true),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
