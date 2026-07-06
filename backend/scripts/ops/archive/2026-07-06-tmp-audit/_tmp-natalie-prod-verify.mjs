import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env.prod.local") });

const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";
const organizationId = process.argv[2] ?? "cmpjd7j7e0001bl5tzv049rxb";

async function fetchRenderEnv() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const data = await res.json();
  const map = {};
  for (const item of data) {
    const envVar = item.envVar ?? item;
    map[envVar.key] = envVar.value;
  }
  return map;
}

function brandIssues(text) {
  const issues = [];
  if (/AI Office Worker/i.test(text)) issues.push("AI Office Worker");
  if (/\bUnknown\b/i.test(text)) issues.push("Unknown");
  if (/^Re:/im.test(text)) issues.push("Re:");
  if (/\bnull\b/i.test(text)) issues.push("null");
  if (/\{"/.test(text)) issues.push("JSON");
  if (/^(לקוח|מה קורה|מה מומלץ):/m.test(text)) issues.push("system labels");
  return issues;
}

const renderEnv = await fetchRenderEnv();
const jwtSecret = renderEnv.JWT_SECRET ?? process.env.PROD_JWT_SECRET ?? process.env.JWT_SECRET;
process.env.DATABASE_URL = process.env.PROD_DATABASE_URL ?? renderEnv.DATABASE_URL;

const prisma = new PrismaClient();
const org = await prisma.organization.findUnique({
  where: { id: organizationId },
  include: { user: true },
});
if (!org?.user) throw new Error(`Organization not found: ${organizationId}`);

const token = jwt.sign(
  { userId: org.user.id, organizationId: org.id, email: org.user.email },
  jwtSecret,
  { expiresIn: "1h" }
);

async function apiPost(path) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body };
}

const healthRes = await fetch(`${apiBase}/health`);
const health = { status: healthRes.status, body: await healthRes.json() };

const testMessage = await apiPost("/api/whatsapp/test");
const morningSummary = await apiPost("/api/whatsapp-assistant/test/morning");

for (const [key, value] of Object.entries(renderEnv)) {
  if (key.startsWith("TWILIO_") || key === "DATABASE_URL") {
    process.env[key] = value;
  }
}

const { notifyNewInvoice } = await import("../src/services/whatsapp.ts");
const invoiceResult = await notifyNewInvoice(organizationId, "Wolt", 1240);

const recentLogs = await prisma.whatsAppLog.findMany({
  where: { organizationId, direction: "outbound" },
  orderBy: { createdAt: "desc" },
  take: 5,
});

const messageAudit = recentLogs.map((log) => ({
  id: log.id,
  createdAt: log.createdAt,
  bodyPreview: log.body?.slice(0, 200),
  chars: log.body?.length ?? 0,
  brandIssues: brandIssues(log.body ?? ""),
  hasNatalie: /נטלי/.test(log.body ?? ""),
}));

console.log(
  JSON.stringify(
    {
      organizationId,
      organizationName: org.name,
      health,
      deployCommitMatch: health.body?.commit?.startsWith("cf4cc37"),
      apiResults: {
        testMessage,
        morningSummary,
        invoiceNotify: invoiceResult,
      },
      messageAudit,
      allBrandClean: messageAudit.every((m) => m.brandIssues.length === 0),
      allHaveNatalieTone: messageAudit.filter((m) => m.bodyPreview?.includes("בוקר טוב") || m.bodyPreview?.includes("הכל תקין") || m.bodyPreview?.includes("חשבונית")).length >= 1,
    },
    null,
    2
  )
);

await prisma.$disconnect();
