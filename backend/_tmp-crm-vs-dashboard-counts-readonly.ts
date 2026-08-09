/**
 * Read-only: compare CRM KPI definitions vs dashboard home-metrics for one org.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(prodUrl);
if (!prodUrl) {
  console.error("missing db url");
  process.exit(1);
}
if (!isLocal && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error("set ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}

const ORG_ID = process.env.VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

async function main() {
  const [
    clientsActive,
    clientsAll,
    leadsAll,
    leadsOpenPipeline, // CRM "לקוחות פעילים"
    leadsStageNew, // CRM "לידים חדשים"
    leadsLeadsFilter, // CRM filter "לידים" = חדש + יצירת קשר
    leadsCustomersFilter, // CRM filter customers
    clientsCreatedThisMonth,
    leadsCreatedThisMonth,
  ] = await Promise.all([
    prisma.client.count({ where: { organizationId: ORG_ID, isActive: true } }),
    prisma.client.count({ where: { organizationId: ORG_ID } }),
    prisma.lead.count({ where: { organizationId: ORG_ID } }),
    prisma.lead.count({
      where: { organizationId: ORG_ID, stage: { notIn: ["הפסד", "סגור"] } },
    }),
    prisma.lead.count({ where: { organizationId: ORG_ID, stage: "חדש" } }),
    prisma.lead.count({
      where: { organizationId: ORG_ID, stage: { in: ["חדש", "יצירת קשר"] } },
    }),
    prisma.lead.count({
      where: { organizationId: ORG_ID, stage: { in: ["בטיפול", "הצעת מחיר", "סגור"] } },
    }),
    prisma.client.count({
      where: {
        organizationId: ORG_ID,
        createdAt: { gte: new Date("2026-07-01T00:00:00+03:00"), lt: new Date("2026-08-01T00:00:00+03:00") },
      },
    }),
    prisma.lead.count({
      where: {
        organizationId: ORG_ID,
        createdAt: { gte: new Date("2026-07-01T00:00:00+03:00"), lt: new Date("2026-08-01T00:00:00+03:00") },
      },
    }),
  ]);

  // Stage breakdown
  const stages = await prisma.lead.groupBy({
    by: ["stage"],
    where: { organizationId: ORG_ID },
    _count: { _all: true },
  });

  console.log(
    JSON.stringify(
      {
        org: ORG_ID,
        clientsActive,
        clientsAll,
        leadsAll,
        crmActiveCustomers_openPipeline: leadsOpenPipeline,
        crmNewLeads_stageNew: leadsStageNew,
        crmFilterLeads: leadsLeadsFilter,
        crmFilterCustomers: leadsCustomersFilter,
        clientsCreatedThisMonth,
        leadsCreatedThisMonth,
        stages: Object.fromEntries(stages.map((s) => [s.stage, s._count._all])),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
