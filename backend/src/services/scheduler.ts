import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { syncGmailForOrganization } from "./gmail-sync.js";
import { scanForInvoices, detectUrgent } from "./invoiceScanner.js";
import { sendDailySummary, buildDailySummary } from "./summary.js";
import { sendWhatsAppMessage } from "./whatsapp.js";
import { generateAccountantReport } from "./accountantReports.js";
import { previousMonth } from "./vatService.js";

const TIMEZONE = "Asia/Jerusalem";
const MAX_RETRIES = 3;

type ScanType = "daily" | "quick" | "monthly" | "health" | "first_time";

type LogUpdate = { status: "success" | "failed" | "partial"; found?: number; saved?: number; errors?: string[] };

class SchedulerService {
  private started = false;

  startAllJobs() {
    if (this.started) return;
    this.started = true;

    cron.schedule("0 2 * * *", () => this.withRetry("daily", () => this.runDailyScan()), { timezone: TIMEZONE });
    cron.schedule("*/30 * * * *", () => this.withRetry("quick", () => this.runQuickScan()), { timezone: TIMEZONE });
    cron.schedule("0 3 * * *", () => this.withRetry("health", () => this.updateAllHealthScores()), { timezone: TIMEZONE });
    cron.schedule("0 8 1 * *", () => this.withRetry("monthly", () => this.generateMonthlyReport()), { timezone: TIMEZONE });
    cron.schedule("0 6 1 * *", () => this.withRetry("monthly", () => this.generateMonthlyAccountantReports()), { timezone: TIMEZONE });

    console.log("[scheduler] All scheduled jobs started");
  }

  async runFirstTimeScan(organizationId: string) {
    const logId = await createScanLog(organizationId, "first_time");
    const errors: string[] = [];
    let found = 0;
    let saved = 0;
    try {
      await syncGmailForOrganization(organizationId, { daysBack: 90, isFirstTime: true });
      const clients = await prisma.client.findMany({ where: { organizationId, isActive: true, gmailConnected: true } });
      for (const client of clients) {
        const result = await scanForInvoices(client.id, { daysBack: 90, limit: 50 });
        found += result.found;
        saved += result.saved;
        errors.push(...result.errors.map((item) => item.error));
      }
      await finishScanLog(logId, { status: errors.length ? "partial" : "success", found, saved, errors });
      return { found, saved, errors };
    } catch (err) {
      errors.push(errorMessage(err));
      await finishScanLog(logId, { status: "failed", found, saved, errors });
      throw err;
    }
  }

  async runDailyScan() {
    const orgs = await prisma.organization.findMany({ include: { integrations: true, clients: true } });
    for (const org of orgs) {
      const logId = await createScanLog(org.id, "daily");
      const errors: string[] = [];
      let found = 0;
      let saved = 0;
      try {
        const hasOrgGmail = org.integrations.some((integration) => integration.provider === "gmail" && integration.refreshToken);
        if (hasOrgGmail) await syncGmailForOrganization(org.id, { daysBack: 1 });
        for (const client of org.clients.filter((client) => client.isActive && client.gmailConnected)) {
          const result = await scanForInvoices(client.id, { daysBack: 1, limit: 50 });
          found += result.found;
          saved += result.saved;
          errors.push(...result.errors.map((item) => item.error));
        }
        await sendDailySummary(org.id, "morning");
        await finishScanLog(logId, { status: errors.length ? "partial" : "success", found, saved, errors });
        console.log(`[scheduler] Daily scan done org=${org.id}`);
      } catch (err) {
        errors.push(errorMessage(err));
        await finishScanLog(logId, { status: "failed", found, saved, errors });
        console.error(`[scheduler] Daily scan failed org=${org.id}`, err);
      }
    }
  }

  async runQuickScan() {
    const orgs = await prisma.organization.findMany({ include: { clients: true } });
    for (const org of orgs) {
      const logId = await createScanLog(org.id, "quick");
      const errors: string[] = [];
      let found = 0;
      let saved = 0;
      try {
        for (const client of org.clients.filter((client) => client.isActive && client.gmailConnected)) {
          const result = await scanForInvoices(client.id, { daysBack: 1, limit: 10 });
          found += result.found;
          saved += result.saved;
          errors.push(...result.errors.map((item) => item.error));
        }
        const urgent = await prisma.emailMessage.findFirst({
          where: { organizationId: org.id, receivedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
          orderBy: { receivedAt: "desc" },
        });
        if (urgent && detectUrgent({ subject: urgent.subject, body: urgent.bodyText })) {
          await sendWhatsAppMessage(org.id, `⚠️ מייל דחוף מ-${urgent.fromAddress}: ${urgent.subject}`);
        }
        await finishScanLog(logId, { status: errors.length ? "partial" : "success", found, saved, errors });
      } catch (err) {
        errors.push(errorMessage(err));
        await finishScanLog(logId, { status: "failed", found, saved, errors });
      }
    }
  }

  async updateAllHealthScores() {
    const orgs = await prisma.organization.findMany();
    for (const org of orgs) {
      const logId = await createScanLog(org.id, "health");
      try {
        await prisma.client.count({ where: { organizationId: org.id, isActive: true } });
        await finishScanLog(logId, { status: "success" });
      } catch (err) {
        await finishScanLog(logId, { status: "failed", errors: [errorMessage(err)] });
      }
    }
  }

  async generateMonthlyReport() {
    const orgs = await prisma.organization.findMany();
    for (const org of orgs) {
      const logId = await createScanLog(org.id, "monthly");
      try {
        const report = await buildDailySummary(org.id);
        await sendWhatsAppMessage(org.id, `סיכום חודשי\n\n${report}`);
        await finishScanLog(logId, { status: "success" });
      } catch (err) {
        await finishScanLog(logId, { status: "failed", errors: [errorMessage(err)] });
      }
    }
  }

  async generateMonthlyAccountantReports() {
    const period = previousMonth();
    const orgs = await prisma.organization.findMany();
    for (const org of orgs) {
      const logId = await createScanLog(org.id, "monthly");
      try {
        await syncGmailForOrganization(org.id, { daysBack: 31 });
        await generateAccountantReport(org.id, period);
        await finishScanLog(logId, { status: "success" });
        console.log(`[scheduler] Accountant report done org=${org.id} period=${period}`);
      } catch (err) {
        await finishScanLog(logId, { status: "failed", errors: [errorMessage(err)] });
        console.error(`[scheduler] Accountant report failed org=${org.id}`, err);
      }
    }
  }

  private async withRetry(type: ScanType, run: () => Promise<void>) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        await run();
        return;
      } catch (err) {
        console.error(`[scheduler] ${type} attempt ${attempt} failed`, err);
        if (attempt < MAX_RETRIES) await wait(15 * 60 * 1000);
      }
    }
  }
}

async function createScanLog(orgId: string, type: ScanType) {
  const id = `scan_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ScanLog" ("id", "orgId", "type", "status", "startedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    id,
    orgId,
    type,
    "running"
  );
  return id;
}

async function finishScanLog(id: string, update: LogUpdate) {
  await prisma.$executeRawUnsafe(
    `UPDATE "ScanLog" SET "status" = $1, "found" = $2, "saved" = $3, "errors" = $4, "endedAt" = CURRENT_TIMESTAMP WHERE "id" = $5`,
    update.status,
    update.found ?? 0,
    update.saved ?? 0,
    update.errors?.length ? update.errors.join("\n") : null,
    id
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export const scheduler = new SchedulerService();
