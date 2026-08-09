/**
 * Post-stabilization production verification.
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const backendDir = process.cwd().endsWith("backend") ? process.cwd() : join(process.cwd(), "backend");
config({ path: join(backendDir, ".env") });
if (existsSync(join(backendDir, ".env.prod.local"))) {
  config({ path: join(backendDir, ".env.prod.local"), override: true });
}

const FRONT = "https://ai-office-worker-frontend.onrender.com";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmpjd7j7e0001bl5tzv049rxb";

async function renderJwtSecret() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = "srv-d898po77f7vs73bu01v0";
  let url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const data = await res.json();
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found");
}

async function renderEnv(key) {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = "srv-d898po77f7vs73bu01v0";
  let url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const data = await res.json();
    for (const item of data) {
      const k = item.envVar?.key ?? item.key;
      const v = item.envVar?.value ?? item.value;
      if (k === key) return v ?? "";
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100&cursor=${cursor}`;
  }
  return "";
}

async function waitDeploy() {
  const apiKey = process.env.RENDER_API_KEY;
  for (let i = 0; i < 40; i++) {
    const deps = await fetch("https://api.render.com/v1/services/srv-d8992s6gvqtc73boqfp0/deploys?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then((r) => r.json());
    const d = deps[0]?.deploy;
    if (d?.status === "live" && d?.commit?.id?.startsWith("95ceca9")) return d;
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("deploy timeout");
}

const secret = await renderJwtSecret();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL.replace("-pooler", "") } } });
const org = await prisma.organization.findUnique({ where: { id: ORG }, include: { user: true } });
const token = jwt.sign({ userId: org.user.id, organizationId: ORG, email: org.user.email }, secret, { expiresIn: "20m" });

const deploy = await waitDeploy();
const health = await fetch(`${API}/health`).then((r) => r.json());

const [complete, incomplete, incomplete300, monthsIncomplete] = await Promise.all([
  fetch(`${API}/api/invoices?completeness=complete`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
  fetch(`${API}/api/invoices?completeness=incomplete`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
  fetch(`${API}/api/invoices?completeness=incomplete&limit=300`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
  fetch(`${API}/api/invoices/months?completeness=incomplete`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
]);

const completeIds = new Set((complete.invoices ?? []).map((r) => r.id));
const overlap = (incomplete300.invoices ?? []).filter((r) => completeIds.has(r.id)).length;
const monthsTotal = (monthsIncomplete.months ?? []).reduce((s, m) => s + m.count, 0);

const html = await fetch(`${FRONT}/reports`).then((r) => r.text());
const reportsSrc = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).find((u) => u.includes("app/reports/page-"));
const reportsChunk = await fetch(reportsSrc.startsWith("http") ? reportsSrc : FRONT + reportsSrc).then((r) => r.text());

const dashHtml = await fetch(`${FRONT}/dashboard/invoices`).then((r) => r.text());
const dashChunk = [...dashHtml.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).find((u) => u.includes("dashboard/invoices/page-"));
const dashJs = dashChunk ? await fetch(dashChunk.startsWith("http") ? dashChunk : FRONT + dashChunk).then((r) => r.text()) : "";

console.log(
  JSON.stringify(
    {
      deploy: { commit: deploy.commit?.id?.slice(0, 7), status: deploy.status, finishedAt: deploy.finishedAt },
      backendCommit: health.commit?.slice(0, 7),
      env: {
        FINANCIAL_DATA_CONTAINMENT: await renderEnv("FINANCIAL_DATA_CONTAINMENT"),
        FINANCIAL_READ_CONTAINMENT: await renderEnv("FINANCIAL_READ_CONTAINMENT"),
        FINANCIAL_INGESTION_CONTAINMENT: await renderEnv("FINANCIAL_INGESTION_CONTAINMENT"),
        BLOCK_NEW_REGISTRATIONS: await renderEnv("BLOCK_NEW_REGISTRATIONS"),
      },
      counts: {
        complete: (complete.invoices ?? []).length,
        incompleteDefault: (incomplete.invoices ?? []).length,
        incomplete300: (incomplete300.invoices ?? []).length,
        monthsIncompleteTotal: monthsTotal,
        overlap,
      },
      bundle: {
        reportsHasHashlemVeAsher: reportsChunk.includes("השלם ואשר"),
        reportsHasHazenSkum: reportsChunk.includes("הזן סכום"),
        dashboardHasLegacyApprove: dashJs.includes("document-reviews") && dashJs.includes("/approve"),
        dashboardHasCompletionBanner: dashJs.includes("completionBanner") || dashJs.includes("השלמת חשבוניות"),
      },
      ingestionBlocked: (await fetch(`${API}/api/gmail/scan`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status === 503,
      recommendation: overlap === 0 && !reportsChunk.includes("השלם ואשר") ? "INVOICE_MODULE_STABILIZATION_COMPLETE" : "INVESTIGATE",
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
