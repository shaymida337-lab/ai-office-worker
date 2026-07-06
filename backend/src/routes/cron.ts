import { Router } from "express";
import { cronMiddleware } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export const cronRouter = Router();
cronRouter.use(cronMiddleware);

cronRouter.post("/gmail-sync-all", async (_req, res) => {
  console.log("[cron/gmail-sync-all] start");
  const orgs = await prisma.organization.findMany({
    include: { integrations: true },
  });
  const results = [];
  for (const org of orgs) {
    const hasGmail = org.integrations.some((i) => i.provider === "gmail" && i.refreshToken);
    if (!hasGmail) {
      console.log(`[cron/gmail-sync-all] skip org=${org.id} reason=no_gmail_refresh_token`);
      continue;
    }
    try {
      const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
      const r = await syncGmailForOrganization(org.id);
      console.log(
        `[cron/gmail-sync-all] org=${org.id} fetched=${r.emailsProcessed ?? 0} parsed=${r.emailsParsed ?? 0} saved=${r.emailsSavedToGmailScanItem ?? 0} driveUploaded=${r.driveUploadsSucceeded ?? 0} rejected=${r.parserRejectedCount ?? r.ignoredCount ?? 0} rejectedReasons=${JSON.stringify(r.ignoredReasons ?? {})}`
      );
      results.push({ organizationId: org.id, ...r });
    } catch (err) {
      console.error(`[cron/gmail-sync-all] org=${org.id} failed`, err);
      results.push({
        organizationId: org.id,
        error: err instanceof Error ? err.message : "error",
      });
    }
  }
  const totals = results.reduce(
    (acc, result) => {
      acc.messagesFetched += "emailsProcessed" in result ? result.emailsProcessed ?? 0 : 0;
      acc.parsed += "emailsParsed" in result ? result.emailsParsed ?? 0 : 0;
      acc.saved += "emailsSavedToGmailScanItem" in result ? result.emailsSavedToGmailScanItem ?? 0 : 0;
      acc.uploadedToDrive += "driveUploadsSucceeded" in result ? result.driveUploadsSucceeded ?? 0 : 0;
      acc.rejected += "parserRejectedCount" in result ? result.parserRejectedCount ?? result.ignoredCount ?? 0 : 0;
      if ("ignoredReasons" in result && result.ignoredReasons) {
        for (const [reason, count] of Object.entries(result.ignoredReasons)) {
          acc.rejectedReasons[reason] = (acc.rejectedReasons[reason] ?? 0) + count;
        }
      }
      return acc;
    },
    {
      messagesFetched: 0,
      parsed: 0,
      saved: 0,
      uploadedToDrive: 0,
      rejected: 0,
      rejectedReasons: {} as Record<string, number>,
    }
  );
  console.log(
    `[cron/gmail-sync-all] final messagesFetched=${totals.messagesFetched} parsed=${totals.parsed} saved=${totals.saved} uploadedToDrive=${totals.uploadedToDrive} rejected=${totals.rejected} rejectedReasons=${JSON.stringify(totals.rejectedReasons)}`
  );
  res.json({ results, totals });
});

cronRouter.post("/whatsapp-morning", async (_req, res) => {
  const {
    logMorningSummarySchedulerEvent,
    MORNING_SUMMARY_TIMEZONE,
  } = await import("../services/whatsapp/morningSummaryScheduler.js");
  logMorningSummarySchedulerEvent({
    trigger: "cron_external",
    decision: { action: "send", reason: "cron_job_started" },
    now: new Date(),
    timeZone: MORNING_SUMMARY_TIMEZONE,
  });

  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    try {
      const { sendDailySummary } = await import("../services/summary.js");
      await sendDailySummary(org.id, "morning");
    } catch (err) {
      console.error(`[cron/whatsapp-morning] org=${org.id} failed`, err);
    }
  }
  res.json({ ok: true, count: orgs.length });
});

cronRouter.post("/whatsapp-evening", async (_req, res) => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    try {
      const { sendDailySummary } = await import("../services/summary.js");
      await sendDailySummary(org.id, "evening");
    } catch (err) {
      console.error(`[cron/whatsapp-evening] org=${org.id} failed`, err);
    }
  }
  res.json({ ok: true, count: orgs.length });
});

cronRouter.post("/upcoming-alerts", async (_req, res) => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    try {
      const { checkUpcomingPaymentAlerts } = await import("../services/summary.js");
      await checkUpcomingPaymentAlerts(org.id);
    } catch (err) {
      console.error(`[cron/upcoming-alerts] org=${org.id} failed`, err);
    }
  }
  res.json({ ok: true });
});

cronRouter.post("/calendar-google-sync-retries", async (req, res) => {
  const rawLimit = Number(req.body?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 50;
  const { runDueAppointmentGoogleSyncRetries } = await import("../services/appointmentGoogleSync.js");
  const result = await runDueAppointmentGoogleSyncRetries(limit);
  res.json({ ok: true, ...result });
});

/** Read-only remediation helper: live Gmail mailbox profile per integration. No DB writes. */
cronRouter.get("/gmail-mailbox-verification", async (_req, res) => {
  const {
    verifyAllGmailMailboxesReadOnly,
    proposeCanonicalMailboxMapping,
    CONTAMINATED_CLUSTER_ORG_IDS,
  } = await import("../services/gmailMailboxVerification.js");

  const verification = await verifyAllGmailMailboxesReadOnly();
  const canonicalProposal = proposeCanonicalMailboxMapping(verification);

  res.json({
    readOnly: true,
    verifiedAt: new Date().toISOString(),
    contaminatedClusterOrganizationIds: CONTAMINATED_CLUSTER_ORG_IDS,
    verificationTable: verification.rows.map((row) => ({
      ...row,
      inContaminatedCluster: CONTAMINATED_CLUSTER_ORG_IDS.includes(
        row.organizationId as (typeof CONTAMINATED_CLUSTER_ORG_IDS)[number]
      ),
    })),
    sharedRefreshTokenHashes: verification.sharedRefreshTokenHashes,
    sharedMailboxEmails: verification.sharedMailboxEmails,
    canonicalMappingProposal: canonicalProposal,
  });
});

/** Controlled single-org incremental Gmail scan (cron auth). No cleanup. */
cronRouter.post("/gmail-scan-incremental", async (req, res) => {
  const organizationId =
    typeof req.body?.organizationId === "string" ? req.body.organizationId.trim() : null;
  if (!organizationId) {
    res.status(400).json({ error: "organizationId required" });
    return;
  }

  const gmailIntegration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "gmail" } },
    select: { refreshToken: true, accessToken: true },
  });
  if (!gmailIntegration?.refreshToken && !gmailIntegration?.accessToken) {
    res.status(409).json({ error: "GMAIL_NOT_CONNECTED", organizationId });
    return;
  }

  const {
    closeStaleGmailScansForOrg,
    createQueuedGmailScanLog,
    findActiveGmailScanLog,
    logScanLifecycle,
    resolveIncrementalGmailScanWindow,
  } = await import("../services/gmailScanLifecycle.js");
  const { syncGmailForOrganization } = await import("../services/gmail-sync.js");

  const incrementalWindow = await resolveIncrementalGmailScanWindow(organizationId);
  const scanMode = "manual_incremental" as const;
  const { daysBack, since, cursorSource } = incrementalWindow;

  console.log(
    `[cron/gmail-scan-incremental] org=${organizationId} scanMode=${scanMode} daysBack=${daysBack} since=${since?.toISOString() ?? "none"} cursorSource=${cursorSource}`
  );

  await closeStaleGmailScansForOrg(organizationId);
  const activeLog = await findActiveGmailScanLog(organizationId);
  if (activeLog) {
    res.json({
      organizationId,
      scanId: activeLog.id,
      status: "running",
      inProgress: true,
      scanMode,
      daysBack,
      since: since?.toISOString() ?? null,
      cursorSource,
    });
    return;
  }

  const { scanLog, created } = await createQueuedGmailScanLog(organizationId, scanMode);
  if (!created) {
    res.json({
      organizationId,
      scanId: scanLog.id,
      status: "running",
      inProgress: true,
      scanMode,
      daysBack,
      since: since?.toISOString() ?? null,
      cursorSource,
    });
    return;
  }

  logScanLifecycle(scanLog.id, "created");
  void syncGmailForOrganization(organizationId, {
    daysBack,
    since,
    scanLogId: scanLog.id,
    scanMode,
  }).catch((err) => {
    console.error(
      `[cron/gmail-scan-incremental] failed org=${organizationId} scanId=${scanLog.id}`,
      err
    );
  });

  res.json({
    organizationId,
    scanId: scanLog.id,
    status: "started",
    inProgress: true,
    scanMode,
    daysBack,
    since: since?.toISOString() ?? null,
    cursorSource,
  });
});
