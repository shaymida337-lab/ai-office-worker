/**
 * READ-ONLY production investigation — lead count discrepancy
 */
import { config } from "dotenv";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env.prod.local") });
process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;

const orgId = process.argv[2] ?? "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient();

const now = new Date();
const in48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

const staleWhere = {
  organizationId: orgId,
  repliedAt: null,
  stage: { notIn: ["סגור", "הפסד"] },
  OR: [{ lastContactAt: null }, { lastContactAt: { lt: in48h } }],
};

const [org, totalLeads, staleCount, newYesterday, byStage, bySource, staleRows, assistant, recentWhatsAppLogs] =
  await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, include: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.lead.count({ where: { organizationId: orgId } }),
    prisma.lead.count({ where: staleWhere }),
    prisma.lead.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: yesterday },
        stage: { notIn: ["סגור", "הפסד"] },
      },
    }),
    prisma.lead.groupBy({ by: ["stage"], where: { organizationId: orgId }, _count: true }),
    prisma.lead.groupBy({ by: ["source"], where: { organizationId: orgId }, _count: true }),
    prisma.lead.findMany({
      where: staleWhere,
      select: {
        id: true,
        name: true,
        source: true,
        stage: true,
        phone: true,
        email: true,
        repliedAt: true,
        lastContactAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.$queryRawUnsafe(
      'SELECT "organizationId","ownerPhone","isActive" FROM "WhatsAppAssistant" WHERE "organizationId" = $1 LIMIT 1',
      orgId
    ),
    prisma.whatsAppLog.findMany({
      where: { organizationId: orgId, direction: "outbound", body: { contains: "ממתינים" } },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, createdAt: true, body: true },
    }),
  ]);

// Check if any leads belong to OTHER orgs with same owner phone pattern
const ownerPhone = assistant[0]?.ownerPhone;
let crossOrgCheck = null;
if (ownerPhone) {
  const assistantsWithPhone = await prisma.$queryRawUnsafe(
    'SELECT "organizationId","ownerPhone" FROM "WhatsAppAssistant" WHERE "ownerPhone" = $1',
    ownerPhone
  );
  crossOrgCheck = assistantsWithPhone;
}

// MessageScan vs Lead confusion?
const messageScanCount = await prisma.messageScan.count({ where: { organizationId: orgId, contactType: "lead" } });

// Simulate exact loadNatalieDailySummaryData lead queries
const simulated = {
  staleLeads: await prisma.lead.count({ where: staleWhere }),
  newLeads: await prisma.lead.count({
    where: {
      organizationId: orgId,
      createdAt: { gte: yesterday },
      stage: { notIn: ["סגור", "הפסד"] },
    },
  }),
};

console.log(
  JSON.stringify(
    {
      org: org ? { id: org.id, name: org.name, userName: org.user?.name, timezone: org.timezone } : null,
      counts: {
        totalLeadsInDb: totalLeads,
        staleLeadsQuery_whatsappUsesThis: staleCount,
        newLeadsLast24h: newYesterday,
        messageScanLeadType: messageScanCount,
        simulatedDailySummary: simulated,
      },
      byStage,
      bySource,
      staleSample_first30: staleRows,
      staleSampleNames: staleRows.map((r) => r.name),
      whatsAppAssistant: assistant[0] ?? null,
      crossOrgAssistantsSamePhone: crossOrgCheck,
      recentOutboundWhatsAppWithMamtinim: recentWhatsAppLogs.map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        bodySnippet: l.body?.slice(0, 350),
      })),
      investigationNote:
        "WhatsApp 'ממתינים' uses staleLeads count = repliedAt null + stage not סגור/הפסד + (lastContactAt null OR >48h stale)",
    },
    null,
    2
  )
);

await prisma.$disconnect();
