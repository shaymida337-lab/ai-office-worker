import { config } from "dotenv";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { buildRealStaleLeadWhere } from "../src/services/crm/leadQuality.ts";
import { buildNatalieDailySummaryMessage } from "../src/services/whatsapp/natalieWhatsAppData.ts";

config({ path: join(process.cwd(), ".env.prod.local") });

const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";
const orgId = "cmpjd7j7e0001bl5tzv049rxb";
const targetCommit = "36dab6e12c5df5fbc7e4601179fcc2104b588e52";
const deployId = "dep-d95mv8btqb8s73cpk1o0";

async function fetchRenderEnv() {
  const res = await fetch(`https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/env-vars?limit=100`, {
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json" },
  });
  const data = await res.json();
  const map = {};
  for (const item of data) {
    const envVar = item.envVar ?? item;
    map[envVar.key] = envVar.value;
  }
  return map;
}

const renderEnv = await fetchRenderEnv();
process.env.DATABASE_URL = process.env.PROD_DATABASE_URL ?? renderEnv.DATABASE_URL;
const jwtSecret = renderEnv.JWT_SECRET ?? process.env.PROD_JWT_SECRET;

const prisma = new PrismaClient();
const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { user: true } });
if (!org?.user) throw new Error(`Organization not found: ${orgId}`);

const token = jwt.sign(
  { userId: org.user.id, organizationId: org.id, email: org.user.email },
  jwtSecret,
  { expiresIn: "1h" }
);

const staleBefore = new Date(Date.now() - 48 * 60 * 60 * 1000);
const oldWhere = {
  organizationId: orgId,
  repliedAt: null,
  stage: { notIn: ["סגור", "הפסד"] },
  OR: [{ lastContactAt: null }, { lastContactAt: { lt: staleBefore } }],
};
const staleWhere = buildRealStaleLeadWhere(orgId, staleBefore);

const healthRes = await fetch(`${apiBase}/health`).then(async (r) => ({ status: r.status, body: await r.json() }));
const [totalLeads, oldStaleCount, newStaleCount] = await Promise.all([
  prisma.lead.count({ where: { organizationId: orgId } }),
  prisma.lead.count({ where: oldWhere }),
  prisma.lead.count({ where: staleWhere }),
]);

const morningApi = await fetch(`${apiBase}/api/whatsapp-assistant/test/morning`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
}).then(async (r) => ({ status: r.status, body: JSON.parse(await r.text()) }));

const summaryPreview = await buildNatalieDailySummaryMessage(orgId);

const recentLogs = await prisma.whatsAppLog.findMany({
  where: { organizationId: orgId, direction: "outbound" },
  orderBy: { createdAt: "desc" },
  take: 3,
  select: { id: true, createdAt: true, body: true },
});

console.log(
  JSON.stringify(
    {
      deployId,
      health: healthRes,
      commitMatch: healthRes.body?.commit === targetCommit || healthRes.body?.commit?.startsWith("36dab6e"),
      leadCounts: {
        totalLeadRows: totalLeads,
        staleOldQuery_beforeFix: oldStaleCount,
        staleNewQuery_afterFix: newStaleCount,
        crmStaleAlertWouldUse: newStaleCount,
        noRowsDeleted: totalLeads === 24,
      },
      morningApi,
      summaryPreview,
      hasNoWaitingLeadsLine: summaryPreview.includes("אין לידים ממתינים"),
      recentWhatsApp: recentLogs.map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        bodySnippet: l.body?.slice(0, 500),
        hasNoWaitingLeads: l.body?.includes("אין לידים ממתינים") ?? false,
      })),
    },
    null,
    2
  )
);

await prisma.$disconnect();
