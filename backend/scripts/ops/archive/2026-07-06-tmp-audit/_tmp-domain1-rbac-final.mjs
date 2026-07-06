/**
 * Domain 1 final RBAC verification — creates temp read_only member, tests, deletes.
 */
import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

config({ path: join(process.cwd(), ".env.prod.local") });

const PILOT_ORG = "cmpjd7j7e0001bl5tzv049rxb";
const OTHER_ORG = "cmqxujfuj034ndy2czu9tjoko";
const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";
const TEMP_EMAIL = `domain1-rbac-verify-${Date.now()}@temp-verify.invalid`;
const TEMP_NAME = "Domain1 RBAC Verify (temp)";

const DEBUG_ENDPOINTS = [
  { method: "GET", path: "/api/debug/gmail/status" },
  { method: "GET", path: "/api/debug/invoices" },
  { method: "GET", path: "/api/debug/invoices/bad-amounts" },
  { method: "GET", path: "/api/debug/payments/top-amounts" },
  { method: "GET", path: "/api/debug/payments/classification-investigation" },
  { method: "GET", path: "/api/debug/payments/open-classification-inputs" },
  { method: "GET", path: "/api/debug/sheets/supplier-payments/verify" },
  { method: "GET", path: "/api/debug/invoices-auth" },
  { method: "GET", path: "/api/debug/drive/merge-status/temp-job" },
  { method: "POST", path: "/api/debug/invoices/fix-bad-amounts", body: {} },
  { method: "POST", path: "/api/debug/drive/merge-duplicate-folders", body: {} },
  { method: "POST", path: "/api/debug/gmail/test-fetch", body: {} },
  { method: "POST", path: "/api/debug/gmail/scan-90", body: {} },
  { method: "POST", path: "/api/debug/payments/apply-classification-cleanup", body: {} },
  { method: "POST", path: "/api/automation/first-scan", body: {} },
  { method: "GET", path: "/api/automation/scan-status" },
  { method: "POST", path: "/api/help/auto-fix/invoices", body: {} },
];

async function fetchJwtSecret() {
  const res = await fetch(
    `https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/env-vars?limit=100`,
    { headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` } },
  );
  const rows = await res.json();
  return rows.find((r) => (r.envVar ?? r).key === "JWT_SECRET")?.envVar?.value;
}

async function api(token, method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.text().then((t) => t.slice(0, 200)) };
}

function isForbidden(status) {
  return status === 403 || status === 401;
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
const jwtSecret = await fetchJwtSecret();

const membersBefore = await prisma.organizationMember.count({ where: { organizationId: PILOT_ORG } });

const user = await prisma.user.create({
  data: { email: TEMP_EMAIL, name: TEMP_NAME, passwordHash: null },
});
const member = await prisma.organizationMember.create({
  data: { organizationId: PILOT_ORG, userId: user.id, role: "read_only" },
});

const token = jwt.sign(
  { userId: user.id, organizationId: PILOT_ORG, email: user.email },
  jwtSecret,
  { expiresIn: "1h" },
);

// 1. Debug endpoints
const debugResults = [];
for (const ep of DEBUG_ENDPOINTS) {
  const r = await api(token, ep.method, ep.path, ep.body);
  debugResults.push({ ...ep, status: r.status, pass: isForbidden(r.status) || r.status === 404 });
}
const debugPass = debugResults.every((r) => r.pass);

// 2. CRM writes
const sampleLead = await prisma.lead.findFirst({
  where: { organizationId: PILOT_ORG },
  select: { id: true },
});
const crmChecks = [
  await api(token, "POST", "/api/leads", { name: "RBAC Test Lead", email: "rbac-test@invalid.local" }),
  ...(sampleLead
    ? [await api(token, "PUT", `/api/leads/${sampleLead.id}`, { name: "RBAC Tamper Attempt" })]
    : []),
  await api(token, "POST", "/api/leads/reply", { leadId: sampleLead?.id ?? "none", body: "test" }),
];
const crmPass = crmChecks.every((r) => isForbidden(r.status));

// 3. Gmail management
const gmailChecks = [
  await api(token, "GET", "/api/integrations/gmail/connect-url"),
  await api(token, "DELETE", "/api/integrations/gmail"),
  await api(token, "POST", "/api/gmail/scan", { daysBack: 1 }),
  await api(token, "POST", "/api/sync/gmail", { daysBack: 1 }),
];
const gmailPass = gmailChecks.every((r) => isForbidden(r.status));

// 4. WhatsApp admin/test endpoints
const whatsappChecks = [
  await api(token, "GET", "/api/whatsapp/test"),
  await api(token, "POST", "/api/whatsapp/test"),
  await api(token, "GET", "/api/integrations/whatsapp/test"),
  await api(token, "POST", "/api/integrations/whatsapp/test"),
  await api(token, "POST", "/api/whatsapp-assistant/test/morning"),
  await api(token, "PUT", "/api/integrations/whatsapp/settings", { ownerPhone: "whatsapp:+10000000000" }),
];
const whatsappPass = whatsappChecks.every((r) => isForbidden(r.status));

// 5. Tenant isolation
const otherClient = await prisma.client.findFirst({
  where: { organizationId: OTHER_ORG },
  select: { id: true },
});
const tenantChecks = {
  crossOrgClient: otherClient
    ? (await api(token, "GET", `/api/clients/${otherClient.id}`)).status
    : null,
  commWithOtherOrgParam: (await api(token, "GET", `/api/communications?organizationId=${OTHER_ORG}&limit=10`)).status,
};
let commBody = null;
const commRes = await fetch(`${apiBase}/api/communications?organizationId=${OTHER_ORG}&limit=10`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (commRes.status === 200) {
  commBody = await commRes.json();
}
const events = commBody?.events ?? commBody?.items ?? [];
const crossOrgEvents = Array.isArray(events)
  ? events.filter((e) => e.organizationId && e.organizationId !== PILOT_ORG)
  : [];
const tenantPass =
  (tenantChecks.crossOrgClient === 403 || tenantChecks.crossOrgClient === 404) &&
  crossOrgEvents.length === 0 &&
  (tenantChecks.commWithOtherOrgParam === 403 || crossOrgEvents.length === 0);

// Cleanup
await prisma.organizationMember.delete({ where: { id: member.id } });
await prisma.user.delete({ where: { id: user.id } });

const membersAfter = await prisma.organizationMember.count({ where: { organizationId: PILOT_ORG } });
const userGone = (await prisma.user.findUnique({ where: { email: TEMP_EMAIL } })) === null;
const cleanupOk = membersAfter === membersBefore && userGone;

const table = {
  "Debug endpoints": debugPass ? "PASS" : "FAIL",
  "CRM writes": crmPass ? "PASS" : "FAIL",
  "Gmail management": gmailPass ? "PASS" : "FAIL",
  "WhatsApp admin endpoints": whatsappPass ? "PASS" : "FAIL",
  "Tenant isolation": tenantPass ? "PASS" : "FAIL",
};

const allPass = Object.values(table).every((v) => v === "PASS") && cleanupOk;

console.log(
  JSON.stringify(
    {
      tempUser: { email: TEMP_EMAIL, role: "read_only", org: PILOT_ORG, created: true, deleted: cleanupOk },
      table,
      cleanup: { membersBefore, membersAfter, userDeleted: userGone, pass: cleanupOk },
      failures: {
        debug: debugResults.filter((r) => !r.pass),
        crm: crmChecks.filter((r) => !isForbidden(r.status)),
        gmail: gmailChecks.filter((r) => !isForbidden(r.status)),
        whatsapp: whatsappChecks.filter((r) => !isForbidden(r.status)),
        tenant: { ...tenantChecks, crossOrgEventCount: crossOrgEvents.length },
      },
      domain1: allPass ? "DOMAIN 1 COMPLETE" : "DOMAIN 1 NOT COMPLETE",
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
process.exit(allPass ? 0 : 1);
