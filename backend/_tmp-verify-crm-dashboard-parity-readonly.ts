/**
 * Read-only: prove dashboard home-metrics CRM fields === getCrmListKpis for org.
 * Forces DATABASE_URL to prod before importing app prisma singleton.
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

// App prisma singleton reads DATABASE_URL at import time.
process.env.DATABASE_URL = prodUrl;

const ORG_ID = process.env.VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

async function main() {
  const { getCrmListKpis } = await import("./src/services/crm/crmCounts.js");
  const { getDashboardHomeMetrics } = await import("./src/services/dashboardHomeMetrics.js");

  const now = new Date();
  const crm = await getCrmListKpis(ORG_ID, now);
  const home = await getDashboardHomeMetrics(ORG_ID, now);

  const leads = await prisma.lead.findMany({
    where: { organizationId: ORG_ID },
    take: 300,
    select: { stage: true, lastContactAt: true, nextReminderAt: true },
  });
  const staleMs = 48 * 60 * 60 * 1000;
  const fromList = {
    activeCustomers: leads.filter((lead) => !["הפסד", "סגור"].includes(lead.stage)).length,
    newLeads: leads.filter((lead) => lead.stage === "חדש").length,
    openTasks: leads.filter((lead) => Boolean(lead.nextReminderAt)).length,
    unattended: leads.filter(
      (lead) => !lead.lastContactAt || Date.now() - lead.lastContactAt.getTime() > staleMs
    ).length,
  };

  // Direct count queries identical to crmCounts.ts
  const directActive = await prisma.lead.count({
    where: { organizationId: ORG_ID, stage: { notIn: ["הפסד", "סגור"] } },
  });
  const directNew = await prisma.lead.count({
    where: { organizationId: ORG_ID, stage: "חדש" },
  });

  const mismatches: string[] = [];
  if (home.metrics.active_clients !== crm.activeCustomers) {
    mismatches.push(`active: home=${home.metrics.active_clients} crm=${crm.activeCustomers}`);
  }
  if (home.metrics.new_clients_this_month !== crm.newLeads) {
    mismatches.push(`newLeads: home=${home.metrics.new_clients_this_month} crm=${crm.newLeads}`);
  }
  if (crm.activeCustomers !== directActive || crm.newLeads !== directNew) {
    mismatches.push(`crm service vs direct count: ${crm.activeCustomers}/${crm.newLeads} vs ${directActive}/${directNew}`);
  }
  if (crm.activeCustomers !== fromList.activeCustomers || crm.newLeads !== fromList.newLeads) {
    mismatches.push(`crm vs list-slice: ${crm.activeCustomers}/${crm.newLeads} vs ${fromList.activeCustomers}/${fromList.newLeads}`);
  }

  console.log(
    JSON.stringify(
      {
        crm,
        dashboard: {
          active_clients: home.metrics.active_clients,
          new_clients_this_month: home.metrics.new_clients_this_month,
        },
        direct: { active: directActive, newLeads: directNew },
        listSliceKpis: fromList,
        match41_38: directActive === 41 && directNew === 38 && home.metrics.active_clients === 41 && home.metrics.new_clients_this_month === 38,
      },
      null,
      2
    )
  );

  if (mismatches.length) {
    console.error("MISMATCH", mismatches);
    process.exit(1);
  }
  if (home.metrics.active_clients !== 41 || home.metrics.new_clients_this_month !== 38) {
    console.error("Expected 41/38 for Shay org");
    process.exit(1);
  }
  console.log("OK: dashboard === CRM service === direct Lead counts === CRM list logic at 41 / 38");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
