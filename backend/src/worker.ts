import cron from "node-cron";
import { prisma } from "./lib/prisma.js";
import { syncGmailForOrganization } from "./services/gmail-sync.js";
import { sendDailySummary, checkUpcomingPaymentAlerts } from "./services/summary.js";

async function runGmailSync() {
  const orgs = await prisma.organization.findMany({
    include: { integrations: true },
  });
  for (const org of orgs) {
    const connected = org.integrations.some(
      (i) => i.provider === "gmail" && i.refreshToken
    );
    if (!connected) continue;
    try {
      console.log(`[worker] Gmail sync org=${org.id}`);
      await syncGmailForOrganization(org.id);
    } catch (err) {
      console.error(`[worker] sync failed org=${org.id}`, err);
    }
  }
}

console.log("[worker] AI Office Worker cron started (Asia/Jerusalem)");

// 07:00 — Gmail scan
cron.schedule("0 7 * * *", runGmailSync, { timezone: "Asia/Jerusalem" });

// 08:00 — WhatsApp morning summary
cron.schedule("0 8 * * *", async () => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) await sendDailySummary(org.id, "morning");
}, { timezone: "Asia/Jerusalem" });

// 18:00 — WhatsApp evening summary
cron.schedule("0 18 * * *", async () => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) await sendDailySummary(org.id, "evening");
}, { timezone: "Asia/Jerusalem" });

// 09:00 — upcoming payment alerts
cron.schedule("0 9 * * *", async () => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) await checkUpcomingPaymentAlerts(org.id);
}, { timezone: "Asia/Jerusalem" });

// Keep process alive
process.stdin.resume();
