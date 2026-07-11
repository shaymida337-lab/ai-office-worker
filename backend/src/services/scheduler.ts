import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { findLastGmailScanSuccessCursor } from "./gmailScanLifecycle.js";
import { syncGmailForOrganization } from "./gmail-sync.js";
import { scanForInvoices, detectUrgent } from "./invoiceScanner.js";
import { buildNatalieDailySummaryMessage, buildNatalieMonthlyReportMessage } from "./whatsapp/natalieWhatsAppData.js";
import { buildNatalieUrgentEmailAlert } from "./whatsapp/natalieWhatsAppUx.js";
import { sendWhatsAppMessage, sendWhatsAppToPhone } from "./whatsapp.js";
import { generateAccountantReport } from "./accountantReports.js";
import { previousMonth } from "./vatService.js";
import { notificationGuard } from "./notificationGuard.js";
import {
  logMorningSummarySchedulerEvent,
  MORNING_SUMMARY_CRON_EXPRESSION,
  MORNING_SUMMARY_TIMEZONE,
  requestMorningSummarySend,
} from "./whatsapp/morningSummaryScheduler.js";
import { clientTemplates } from "./messageTemplates.js";
import { publishDueSocialPosts } from "./socialMedia.js";
import { processCrmNotifications, processLeadSequences } from "./crm.js";
import { initialConnectScanWindow } from "./scanWindow.js";
import {
  closeStaleGmailScansForOrg,
  createQueuedGmailScanLog,
  finalizeGmailScanFailed,
  findActiveGmailScanLog,
} from "./gmailScanLifecycle.js";
import { timeoutStaleJobRuns } from "./jobRunLifecycle.js";
import { markNoResponseDueAppointments, processDueReminderJobs } from "./reminders/reminderService.js";

const TIMEZONE = "Asia/Jerusalem";
const MAX_RETRIES = 3;
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL;
const FAST_GMAIL_SCAN_INTERVAL_MS = 2 * 60 * 1000;
const FAST_GMAIL_SCAN_START_DELAY_MS = 5_000;

type ScanType = "daily" | "quick" | "monthly" | "health" | "first_time" | "whatsapp" | "social" | "crm" | "gmail_auto" | "gmail_retry";
type AssistantRow = { organizationId: string; ownerPhone: string; isActive: boolean };
type RuleFlags = { ownerMorningReport: boolean; clientMorningSummary: boolean; clientPaymentReminder: boolean; clientPaymentDaysWait: number };

type LogUpdate = { status: "success" | "failed" | "partial"; found?: number; saved?: number; errors?: string[] };

class SchedulerService {
  private started = false;
  private fastGmailScanInterval?: NodeJS.Timeout;
  private fastGmailScanRunning = false;

  startAllJobs() {
    if (this.started) return;
    this.started = true;

    console.log("[scheduler] FAST_SCAN_SERVICE_INITIALIZED");
    this.fastGmailScanInterval = setInterval(() => {
      void this.runFastGmailScans("interval");
    }, FAST_GMAIL_SCAN_INTERVAL_MS);
    console.log(`[scheduler] FAST_SCAN_INTERVAL_REGISTERED intervalMs=${FAST_GMAIL_SCAN_INTERVAL_MS} initialDelayMs=${FAST_GMAIL_SCAN_START_DELAY_MS}`);
    setTimeout(() => {
      void this.runFastGmailScans("startup");
    }, FAST_GMAIL_SCAN_START_DELAY_MS);

    cron.schedule("0 2 * * *", () => this.withRetry("daily", () => this.runDailyScan()), { timezone: TIMEZONE });
    cron.schedule("*/30 * * * *", () => this.withRetry("quick", () => this.runQuickScan()), { timezone: TIMEZONE });
    cron.schedule("0 3 * * *", () => this.runAutomaticGmailScans("auto_daily"), { timezone: TIMEZONE });
    cron.schedule("30 3 * * 0", () => this.runAutomaticGmailScans("auto_weekly"), { timezone: TIMEZONE });
    cron.schedule("30 4 * * *", () => this.withRetry("health", () => this.updateAllHealthScores()), { timezone: TIMEZONE });
    cron.schedule("0 8 1 * *", () => this.withRetry("monthly", () => this.generateMonthlyReport()), { timezone: TIMEZONE });
    cron.schedule("0 6 1 * *", () => this.withRetry("monthly", () => this.generateMonthlyAccountantReports()), { timezone: TIMEZONE });
    cron.schedule(MORNING_SUMMARY_CRON_EXPRESSION, () => {
      logMorningSummarySchedulerEvent({
        trigger: "cron_scheduler_owner",
        decision: { action: "send", reason: "cron_job_started" },
        now: new Date(),
        timeZone: MORNING_SUMMARY_TIMEZONE,
      });
      return this.withRetry("whatsapp", () => this.sendOwnerMorningReports());
    }, { timezone: TIMEZONE });
    cron.schedule("15 8 * * 0-5", () => {
      logMorningSummarySchedulerEvent({
        trigger: "cron_scheduler_client",
        decision: { action: "send", reason: "cron_job_started" },
        now: new Date(),
        timeZone: MORNING_SUMMARY_TIMEZONE,
      });
      return this.withRetry("whatsapp", () => this.sendClientMorningBriefs());
    }, { timezone: TIMEZONE });
    cron.schedule("0 10 * * 0-5", () => this.withRetry("whatsapp", () => this.sendPaymentReminders()), { timezone: TIMEZONE });
    cron.schedule("0 * * * *", () => this.withRetry("social", () => this.publishApprovedSocialPosts()), { timezone: TIMEZONE });
    cron.schedule("*/15 * * * *", () => this.withRetry("crm", () => this.processCrmSequences()), { timezone: TIMEZONE });
    cron.schedule("* * * * *", () => void timeoutStaleJobRuns(), { timezone: TIMEZONE });
    cron.schedule("* * * * *", () => void processDueReminderJobs("scheduler"), { timezone: "UTC" });
    cron.schedule("*/5 * * * *", () => void markNoResponseDueAppointments(), { timezone: "UTC" });
    cron.schedule("*/8 * * * *", () => this.pingKeepAlive(), { timezone: TIMEZONE });

    console.log("[scheduler] All scheduled jobs started");
  }

  private async pingKeepAlive() {
    if (!KEEP_ALIVE_URL) return;

    try {
      await fetch(KEEP_ALIVE_URL);
    } catch (err) {
      console.warn("[scheduler] Keep-alive ping failed", errorMessage(err));
    }
  }

  async runFirstTimeScan(organizationId: string) {
    const { assertFinancialIngestionAllowed } = await import("./p0/financialContainment.js");
    assertFinancialIngestionAllowed(organizationId);

    const logId = await createScanLog(organizationId, "first_time");
    const errors: string[] = [];
    let found = 0;
    let saved = 0;
    try {
      const initialWindow = initialConnectScanWindow();
      await syncGmailForOrganization(organizationId, { isFirstTime: true });
      const clients = await prisma.client.findMany({ where: { organizationId, isActive: true, gmailConnected: true } });
      for (const client of clients) {
        const result = await scanForInvoices(client.id, { daysBack: initialWindow.daysBack, limit: 50 });
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

  async runAutomaticGmailScans(mode: "auto_daily" | "auto_weekly" = "auto_daily") {
    const { isFinancialIngestionContainmentActive } = await import("./p0/financialContainment.js");
    if (isFinancialIngestionContainmentActive()) {
      console.warn(`[scheduler] automatic Gmail ${mode} skipped — financial ingestion containment active`);
      return;
    }

    const orgs = await prisma.organization.findMany({
      where: { integrations: { some: { provider: "gmail", refreshToken: { not: null } } } },
      select: { id: true },
    });

    console.log(`[scheduler] automatic Gmail ${mode} start orgs=${orgs.length}`);
    for (const org of orgs) {
      await this.runAutomaticGmailScanForOrg(org.id, mode, 0).catch((err) => {
        console.error(`[scheduler] automatic Gmail ${mode} failed org=${org.id}`, err);
      });
    }
  }

  async runFastGmailScans(source: "startup" | "interval" | "manual" = "manual") {
    const { isFinancialIngestionContainmentActive } = await import("./p0/financialContainment.js");
    if (isFinancialIngestionContainmentActive()) {
      console.warn(`[scheduler] FAST_SCAN skipped source=${source} — financial ingestion containment active`);
      return;
    }

    if (this.fastGmailScanRunning) {
      console.log(`[scheduler] FAST_SCAN_SKIPPED source=${source} reason=already_running`);
      return;
    }

    this.fastGmailScanRunning = true;
    const startedAt = Date.now();
    try {
      const orgs = await prisma.organization.findMany({
        where: { integrations: { some: { provider: "gmail", refreshToken: { not: null } } } },
        select: { id: true },
      });

      console.log(`[scheduler] FAST_SCAN_TRIGGERED source=${source} orgs=${orgs.length}`);
      for (const org of orgs) {
        await syncGmailForOrganization(org.id, {
          fastOnly: true,
          maxMessages: 20,
          scanMode: "fast_recurring",
        }).catch((err) => {
          console.error(`[scheduler] FAST_SCAN_TRIGGERED failed org=${org.id}`, err);
        });
      }
      console.log(`[scheduler] FAST_SCAN_COMPLETED source=${source} orgs=${orgs.length} durationMs=${Date.now() - startedAt}`);
    } catch (err) {
      console.error(`[scheduler] FAST_SCAN_TRIGGERED failed source=${source}`, err);
    } finally {
      this.fastGmailScanRunning = false;
    }
  }

  private async runAutomaticGmailScanForOrg(organizationId: string, mode: "auto_daily" | "auto_weekly" | "retry", retryAttempt: 0 | 1, retryOfId?: string) {
    await closeStaleGmailScansForOrg(organizationId);
    const active = await findActiveGmailScanLog(organizationId);
    if (active) {
      console.log(`[scheduler] automatic Gmail skipped org=${organizationId} reason=scan_already_active scanId=${active.id}`);
      return;
    }

    const lastSuccess = await findLastGmailScanSuccessCursor(organizationId);
    const created = await createQueuedGmailScanLog(organizationId, mode, retryOfId);
    if (!created.created) {
      console.log(`[scheduler] automatic Gmail skipped org=${organizationId} reason=db_scan_lock_active scanId=${created.scanLog.id}`);
      return;
    }
    const scanLog = created.scanLog;

    try {
      const fullRescan = mode === "auto_weekly";
      const result = await syncGmailForOrganization(organizationId, {
        scanLogId: scanLog.id,
        scanMode: mode,
        retryOfId,
        since: fullRescan ? undefined : lastSuccess?.finishedAt ?? undefined,
        daysBack: fullRescan ? 30 : 1,
        forceReprocess: fullRescan,
      });
      if ("inProgress" in result && result.inProgress) {
        const activeId = "scanLogId" in result ? result.scanLogId : scanLog.id;
        console.log(`[scheduler] automatic Gmail inProgress org=${organizationId} scanId=${activeId}`);
        return;
      }
      const done = result as {
        emailsProcessed?: number;
        emailsSavedToGmailScanItem?: number;
        invoicesCreated?: number;
        paymentsCreated?: number;
        driveUploadsSucceeded?: number;
        sheetsUpdated?: number;
        errorsCount?: number;
      };
      console.log(
        `[scheduler] automatic Gmail done org=${organizationId} scanId=${scanLog.id} mode=${mode} emails=${done.emailsProcessed ?? 0} saved=${done.emailsSavedToGmailScanItem ?? 0} invoices=${done.invoicesCreated ?? 0} payments=${done.paymentsCreated ?? 0} drive=${done.driveUploadsSucceeded ?? 0} sheets=${done.sheetsUpdated ?? 0} errors=${done.errorsCount ?? 0}`
      );
    } catch (err) {
      const message = errorMessage(err);
      console.error(`[scheduler] automatic Gmail failed org=${organizationId} scanId=${scanLog.id} mode=${mode}`, err);
      await finalizeGmailScanFailed(scanLog.id, message);
      if (retryAttempt === 0) {
        const nextRetryAt = new Date(Date.now() + 30 * 60 * 1000);
        console.log(`[scheduler] automatic Gmail retry scheduled org=${organizationId} at=${nextRetryAt.toISOString()}`);
        setTimeout(() => {
          void this.runAutomaticGmailScanForOrg(organizationId, "retry", 1, scanLog.id);
        }, 30 * 60 * 1000);
      }
    }
  }

  async runDailyScan() {
    const { isFinancialIngestionContainmentActive } = await import("./p0/financialContainment.js");
    if (isFinancialIngestionContainmentActive()) {
      console.warn("[scheduler] daily scan skipped — financial ingestion containment active");
      return;
    }

    const orgs = await prisma.organization.findMany({ include: { integrations: true, clients: true } });
    for (const org of orgs) {
      const logId = await createScanLog(org.id, "daily");
      const errors: string[] = [];
      let found = 0;
      let saved = 0;
      try {
        for (const client of org.clients.filter((client) => client.isActive && client.gmailConnected)) {
          const result = await scanForInvoices(client.id, { daysBack: 1, limit: 50 });
          found += result.found;
          saved += result.saved;
          errors.push(...result.errors.map((item) => item.error));
        }
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
    const { isFinancialIngestionContainmentActive } = await import("./p0/financialContainment.js");
    if (isFinancialIngestionContainmentActive()) {
      console.warn("[scheduler] quick scan skipped — financial ingestion containment active");
      return;
    }

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
          await sendWhatsAppMessage(org.id, buildNatalieUrgentEmailAlert());
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
        const report = await buildNatalieMonthlyReportMessage(org.id);
        await sendWhatsAppMessage(org.id, report);
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

  async sendOwnerMorningReports() {
    const assistants = await prisma.$queryRawUnsafe<AssistantRow[]>(
      'SELECT "organizationId","ownerPhone","isActive" FROM "WhatsAppAssistant" WHERE "isActive" = true'
    );

    for (const assistant of assistants) {
      try {
        const flags = await getRuleFlags(assistant.organizationId);
        if (!flags.ownerMorningReport) continue;

        const morningDecision = await requestMorningSummarySend({
          organizationId: assistant.organizationId,
          trigger: "cron_scheduler_owner",
        });
        if (morningDecision.action === "skip") continue;

        // RULE: Max 2 messages per day per number
        // RULE: No messages 21:00-07:00
        // RULE: No messages on Saturday
        const canSend = await notificationGuard.canSend(assistant.ownerPhone, assistant.organizationId, "morning_report");
        if (!canSend.allowed) continue;

        const message = await buildNatalieDailySummaryMessage(assistant.organizationId);
        const sent = await sendWhatsAppToPhone(assistant.organizationId, assistant.ownerPhone, message, undefined, true);
        if (sent.sent) await notificationGuard.logSent(assistant.ownerPhone, assistant.organizationId, "morning_report", message, undefined, true);
      } catch (err) {
        console.error("[scheduler] Owner morning WhatsApp failed", err);
      }
    }
  }

  async sendClientMorningBriefs() {
    const clients = await prisma.client.findMany({ where: { whatsappNumber: { not: null }, isActive: true } });
    for (const client of clients) {
      if (!client.whatsappNumber) continue;
      try {
        const flags = await getRuleFlags(client.organizationId);
        if (!flags.clientMorningSummary) continue;
        // RULE: Max 2 messages per day per number
        // RULE: No messages 21:00-07:00
        // RULE: No messages on Saturday
        const canSend = await notificationGuard.canSend(client.whatsappNumber, client.organizationId, "morning_brief");
        if (!canSend.allowed) continue;

        const data = await buildClientBriefData(client.id);
        // RULE: Only send if content is relevant
        if (data.tasksToday === 0 && !data.pendingInvoice) continue;

        const message = clientTemplates.morningBrief(data);
        const sent = await sendWhatsAppToPhone(client.organizationId, client.whatsappNumber, message, client.id, true);
        if (sent.sent) await notificationGuard.logSent(client.whatsappNumber, client.organizationId, "morning_brief", message, client.id);
      } catch (err) {
        console.error(`[scheduler] Client morning brief failed client=${client.id}`, err);
      }
    }
  }

  async sendPaymentReminders() {
    const invoices = await prisma.invoice.findMany({
      where: { status: "pending", dueDate: { not: null } },
      include: { client: true },
      take: 100,
    });

    for (const invoice of invoices) {
      const client = invoice.client;
      if (!client.whatsappNumber || !invoice.dueDate) continue;
      try {
        const flags = await getRuleFlags(client.organizationId);
        if (!flags.clientPaymentReminder) continue;
        const threshold = new Date(Date.now() - flags.clientPaymentDaysWait * 24 * 60 * 60 * 1000);
        if (invoice.dueDate > threshold) continue;
        // RULE: Max 2 messages per day per number
        // RULE: No messages 21:00-07:00
        // RULE: No messages on Saturday
        // RULE: Payment reminder max once per 7 days
        const canSend = await notificationGuard.canSend(client.whatsappNumber, client.organizationId, "payment_reminder");
        if (!canSend.allowed) continue;

        const daysOverdue = Math.floor((Date.now() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        // RULE: Only send if content is relevant
        const message = clientTemplates.paymentReminder({
          clientName: client.name,
          invoiceNumber: invoice.invoiceNumber || "---",
          amount: invoice.amount,
          daysOverdue,
        });
        const sent = await sendWhatsAppToPhone(client.organizationId, client.whatsappNumber, message, client.id, true);
        if (sent.sent) await notificationGuard.logSent(client.whatsappNumber, client.organizationId, "payment_reminder", message, client.id);
      } catch (err) {
        console.error(`[scheduler] Payment reminder failed invoice=${invoice.id}`, err);
      }
    }
  }

  async publishApprovedSocialPosts() {
    await publishDueSocialPosts();
  }

  async processCrmSequences() {
    const [sequences, notifications] = await Promise.all([
      processLeadSequences(),
      processCrmNotifications(),
    ]);
    if (sequences.sent || sequences.errors.length || notifications.created) {
      console.log(`[scheduler] CRM sequences sent=${sequences.sent} errors=${sequences.errors.length} notifications=${notifications.created}`);
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

async function createRunningGmailScanLog(organizationId: string, scanMode: string, retryOfId?: string) {
  const created = await createQueuedGmailScanLog(organizationId, scanMode, retryOfId);
  return created.created ? created.scanLog : null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function buildClientBriefData(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const [tasksToday, pendingInvoice] = await Promise.all([
    prisma.task.count({ where: { clientId, status: "open", dueDate: { lte: todayEnd } } }),
    prisma.invoice.aggregate({ where: { clientId, status: { not: "paid" } }, _sum: { amount: true } }),
  ]);
  return {
    clientName: client?.name ?? "לקוח",
    tasksToday,
    pendingInvoice: pendingInvoice._sum.amount ?? undefined,
    tip: tasksToday > 0 ? "מומלץ לסגור קודם את המשימות הדחופות." : undefined,
  };
}

async function getRuleFlags(organizationId: string): Promise<RuleFlags> {
  const rows = await prisma.$queryRawUnsafe<RuleFlags[]>(
    'SELECT "ownerMorningReport","clientMorningSummary","clientPaymentReminder","clientPaymentDaysWait" FROM "NotificationRules" WHERE "organizationId" = $1 LIMIT 1',
    organizationId
  );
  return rows[0] ?? { ownerMorningReport: true, clientMorningSummary: true, clientPaymentReminder: true, clientPaymentDaysWait: 7 };
}

export const scheduler = new SchedulerService();
