import cron from "node-cron";
import { prisma } from "./lib/prisma.js";
import { syncGmailForOrganization } from "./services/gmail-sync.js";
import { sendDailySummary, checkUpcomingPaymentAlerts } from "./services/summary.js";
import {
  logMorningSummarySchedulerEvent,
  MORNING_SUMMARY_CRON_EXPRESSION,
  MORNING_SUMMARY_TIMEZONE,
} from "./services/whatsapp/morningSummaryScheduler.js";

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
      await syncGmailForOrganization(org.id);
    } catch (err) {
      console.error(`[worker] sync failed org=${org.id}`, err);
    }
  }
}

// 07:00 — Gmail scan
cron.schedule("0 7 * * *", runGmailSync, { timezone: "Asia/Jerusalem" });

// 08:00 — WhatsApp morning summary (Asia/Jerusalem, 08:00–09:00 window)
cron.schedule(MORNING_SUMMARY_CRON_EXPRESSION, async () => {
  logMorningSummarySchedulerEvent({
    trigger: "cron_worker",
    decision: { action: "send", reason: "cron_job_started" },
    now: new Date(),
    timeZone: MORNING_SUMMARY_TIMEZONE,
  });
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) await sendDailySummary(org.id, "morning");
}, { timezone: MORNING_SUMMARY_TIMEZONE });

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
