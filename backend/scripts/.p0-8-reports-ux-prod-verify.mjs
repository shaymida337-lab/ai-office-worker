/**
 * Post-deploy production verification for reports UX labels.
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

// Mirror completion action logic from deployed frontend
function missingFieldKeys(invoice) {
  const keys = new Set();
  const reasons = invoice.missingDataReasons ?? [];
  if (reasons.length > 0) {
    for (const reason of reasons) {
      if (reason.includes("ספק")) keys.add("supplier");
      if (reason.includes("סכום")) keys.add("amount");
      if (reason.includes("תאריך")) keys.add("date");
      if (reason.includes("מטבע")) keys.add("currency");
      if (reason.includes("סוג מסמך")) keys.add("documentType");
    }
    return keys;
  }
  if (!invoice.supplierName?.trim()) keys.add("supplier");
  if (invoice.amount == null || !Number.isFinite(invoice.amount)) keys.add("amount");
  if (!invoice.date?.trim()) keys.add("date");
  if (!invoice.documentType?.trim()) keys.add("documentType");
  if (!invoice.currency?.trim()) keys.add("currency");
  return keys;
}

const FIELD_LABELS = {
  amount: "הזן סכום",
  supplier: "בחר ספק",
  date: "בחר תאריך",
  documentType: "בחר סוג מסמך",
  currency: "בחר מטבע",
};

function getAction(invoice) {
  if (invoice.approvalBlockReason === "blocked_outcome") return "בדוק מסמך";
  if (invoice.supplierNeedsConfirmation || invoice.approvalBlockReason === "supplier.needs_confirmation") return "אשר ספק";
  if (invoice.dataComplete && invoice.approvalRequired && invoice.canApproveDirectly) return "אשר";
  if (!invoice.dataComplete) {
    const missing = missingFieldKeys(invoice);
    if (missing.size >= 2) return "ערוך פרטים";
    if (missing.size === 1) return FIELD_LABELS[[...missing][0]];
    return "ערוך פרטים";
  }
  return "ערוך פרטים";
}

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

async function scanBundle() {
  const html = await fetch(`${FRONT}/reports`).then((r) => r.text());
  const reportsSrc = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).find((u) => u.includes("app/reports/page-"));
  const reportsUrl = reportsSrc.startsWith("http") ? reportsSrc : FRONT + reportsSrc;
  const text = await fetch(reportsUrl).then((r) => r.text());
  return {
    reportsChunk: reportsSrc.split("/").pop(),
    hasHashlemVeAsher: text.includes("השלם ואשר"),
    labels: {
      hazenSkum: text.includes("הזן סכום"),
      bcharSapak: text.includes("בחר ספק"),
      asherSapak: text.includes("אשר ספק"),
      arochPratim: text.includes("ערוך פרטים"),
      bdokMismach: text.includes("בדוק מסמך"),
      asher: text.includes("אשר"),
    },
  };
}

const secret = await renderJwtSecret();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL.replace("-pooler", "") } } });
const org = await prisma.organization.findUnique({ where: { id: ORG }, include: { user: true } });
const token = jwt.sign({ userId: org.user.id, organizationId: ORG, email: org.user.email }, secret, { expiresIn: "20m" });
const data = await fetch(`${API}/api/invoices?completeness=incomplete`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
}).then((r) => r.json());

const labelCounts = {};
const samples = {};
for (const row of data.invoices ?? []) {
  const label = getAction(row);
  labelCounts[label] = (labelCounts[label] ?? 0) + 1;
  if (!samples[label]) samples[label] = row.id;
}

const bundle = await scanBundle();
const health = await fetch(`${API}/health`).then((r) => r.json());

console.log(
  JSON.stringify(
    {
      frontendDeploy: "a55d76b",
      backendCommit: health.commit?.slice(0, 7),
      bundle,
      labelCounts,
      samplesByLabel: samples,
      hasOldLabel: Object.keys(labelCounts).includes("השלם ואשר"),
      recommendation: !bundle.hasHashlemVeAsher && !Object.keys(labelCounts).includes("השלם ואשר")
        ? "REPORTS_UI_PRODUCTION_FIXED"
        : "INVESTIGATE",
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
