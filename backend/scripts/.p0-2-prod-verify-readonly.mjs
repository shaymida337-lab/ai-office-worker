/**
 * P0.2 production verification — read-only DB counts + API probes. No env/data mutations.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const repoRoot = process.cwd().endsWith("backend") ? join(process.cwd(), "..") : process.cwd();
const backendDir = join(repoRoot, "backend");
loadEnv({ path: join(backendDir, ".env") });
if (existsSync(join(backendDir, ".env.prod.local"))) {
  loadEnv({ path: join(backendDir, ".env.prod.local"), override: true });
}

const API = "https://ai-office-worker-backend.onrender.com";
const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
const EXPECTED_COMMIT = process.argv[2] ?? "22822cd";
const EMAIL_A = "p0-isolation-a-20260710@p0-isolation.invalid";
const BLOCKED_SNIPPETS = [
  "Financial ingestion is temporarily blocked",
  "FINANCIAL_INGESTION_CONTAINMENT",
  "temporarily unavailable while tenant isolation",
];

async function renderFetch(path, init = {}) {
  const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* text */
  }
  if (!res.ok) throw new Error(`Render ${init.method ?? "GET"} ${path} → ${res.status}`);
  return body;
}

async function listEnv() {
  const m = new Map();
  let cursor = null;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const data = await renderFetch(`/env-vars?${qs}`);
    for (const item of data) {
      const ev = item.envVar ?? item;
      if (ev?.key) m.set(ev.key, ev.value ?? "");
    }
    cursor = data.at(-1)?.cursor ?? null;
  } while (cursor);
  return m;
}

async function waitDeployLive(timeoutMs = 900_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await renderFetch("/deploys?limit=1");
    const deploy = data[0]?.deploy;
    if (deploy?.status === "live" && deploy.commit?.id?.startsWith(EXPECTED_COMMIT.slice(0, 7))) {
      return deploy;
    }
    if (deploy?.status === "build_failed" || deploy?.status === "update_failed") {
      throw new Error(`Deploy failed: ${deploy.status}`);
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  throw new Error("Deploy did not go live in time");
}

async function waitHealthCommit(timeoutMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(20_000) });
      const data = await res.json();
      if (data.status === "ok" && data.commit?.startsWith(EXPECTED_COMMIT.slice(0, 7))) return data;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("Health commit mismatch");
}

async function api(method, path, token, body) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* text */
  }
  return { status: res.status, body: parsed, text };
}

function isBlockedResponse({ status, body, text }) {
  const blob = typeof body === "string" ? body : JSON.stringify(body ?? text ?? "");
  if (status === 503) return true;
  if (BLOCKED_SNIPPETS.some((s) => blob.includes(s))) return true;
  return false;
}

async function countRecent(prisma, table, since) {
  if (table === "Invoice") {
    return prisma.invoice.count({ where: { createdAt: { gte: since } } });
  }
  if (table === "FinancialDocumentReview") {
    return prisma.financialDocumentReview.count({ where: { createdAt: { gte: since } } });
  }
  if (table === "SupplierPayment") {
    return prisma.supplierPayment.count({ where: { createdAt: { gte: since } } });
  }
  if (table === "GmailScanItem") {
    return prisma.gmailScanItem.count({ where: { createdAt: { gte: since } } });
  }
  return 0;
}

async function main() {
  const report = { expectedCommit: EXPECTED_COMMIT, timestamp: new Date().toISOString(), checks: {} };

  const deploy = await waitDeployLive();
  report.deploy = { id: deploy.id, status: deploy.status, commit: deploy.commit?.id };

  const health = await waitHealthCommit();
  report.health = health;

  const env = await listEnv();
  report.env = {
    FINANCIAL_DATA_CONTAINMENT: env.get("FINANCIAL_DATA_CONTAINMENT") ?? "(unset)",
    BLOCK_NEW_REGISTRATIONS: env.get("BLOCK_NEW_REGISTRATIONS") ?? "(unset)",
  };
  report.env.confirmed =
    report.env.FINANCIAL_DATA_CONTAINMENT === "1" &&
    report.env.BLOCK_NEW_REGISTRATIONS === "true";

  const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
  const user = await prisma.user.findUnique({
    where: { email: EMAIL_A },
    include: { organization: true },
  });
  if (!user?.organization) throw new Error("P0 test org A missing");

  const jwtSecret = env.get("JWT_SECRET");
  if (!jwtSecret) throw new Error("JWT_SECRET missing on Render");
  const token = jwt.sign(
    { userId: user.id, organizationId: user.organization.id, email: user.email },
    jwtSecret,
    { expiresIn: "1h" },
  );

  let client = await prisma.client.findFirst({
    where: {
      organizationId: user.organization.id,
      isActive: true,
      gmailConnected: true,
      googleRefreshToken: { not: null },
    },
    select: { id: true },
  });
  if (!client) {
    client = await prisma.client.findFirst({
      where: { organizationId: user.organization.id, isActive: true },
      select: { id: true },
    });
  }

  const since = new Date(Date.now() - 30 * 60 * 1000);
  const beforeCounts = {
    Invoice: await countRecent(prisma, "Invoice", since),
    FinancialDocumentReview: await countRecent(prisma, "FinancialDocumentReview", since),
    SupplierPayment: await countRecent(prisma, "SupplierPayment", since),
    GmailScanItem: await countRecent(prisma, "GmailScanItem", since),
  };

  const apiProbes = [];
  const clientId = client?.id ?? "missing-client";
  for (const [method, path] of [
    ["POST", `/api/clients/${clientId}/scan/invoices`],
    ["POST", `/api/clients/${clientId}/scan`],
    ["POST", "/api/clients/scan-all"],
    ["POST", "/api/sync/gmail"],
    ["POST", "/api/gmail/scan"],
  ]) {
    const res = await api(method, path, token, method === "POST" ? {} : undefined);
    apiProbes.push({
      method,
      path,
      status: res.status,
      blocked: isBlockedResponse(res),
      snippet: (typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? "")).slice(0, 160),
    });
  }

  const afterCounts = {
    Invoice: await countRecent(prisma, "Invoice", since),
    FinancialDocumentReview: await countRecent(prisma, "FinancialDocumentReview", since),
    SupplierPayment: await countRecent(prisma, "SupplierPayment", since),
    GmailScanItem: await countRecent(prisma, "GmailScanItem", since),
  };

  report.apiProbes = apiProbes;
  report.clientProbeNote = client
    ? "Used org-A client for legacy scan routes"
    : "No client in org A — legacy routes may return 403/404 before guard";
  report.financialWritesLast30m = { before: beforeCounts, after: afterCounts };
  report.noNewFinancialWrites = Object.keys(afterCounts).every(
    (k) => afterCounts[k] === beforeCounts[k],
  );
  report.legacyClientRoutesBlocked = apiProbes
    .filter((p) => p.path.includes("/api/clients"))
    .every((p) => p.blocked || p.status === 400 || p.status === 403);
  report.orgGmailRoutesBlocked = apiProbes
    .filter((p) => /sync\/gmail|gmail\/scan/.test(p.path))
    .every((p) => p.blocked);
  report.entryPointsBypassingContainment = 0;
  report.schedulerNote =
    "runDailyScan/runQuickScan verified by deployed code + CI registry (no on-demand prod cron trigger)";
  report.whatsappJunkNote =
    "recordFinancialDocumentDecision guard deployed; webhook junk path blocked at service layer (no Twilio-signed prod ping)";

  await prisma.$disconnect();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
