import { prisma } from "../../../lib/prisma.js";
import {
  buildReliabilityFingerprint,
  recordReliabilityEvent,
  resolveReliabilityEvent,
} from "./reliabilityEventRepository.js";
import {
  closeStaleGmailScansForOrg as closeStaleGmailScansForOrgDefault,
  reapOverdueLegacyScanLogs as reapOverdueLegacyScanLogsDefault,
} from "../../gmailScanLifecycle.js";

export type ReliabilitySelfHealingDeps = {
  reapOverdueLegacyScanLogs?: (nowMs: number) => Promise<number>;
  closeStaleGmailScansForOrg?: (organizationId: string) => Promise<string[]>;
  countActiveGmailSyncScans?: (organizationId: string) => Promise<number>;
  countActiveLegacyScanLogs?: (organizationId: string) => Promise<number>;
};

/**
 * Safe self-healing pass for Reliability Center V1.
 * Only closes known-safe zombie jobs and mirrors results into reliability events.
 * Does NOT change invoice/calendar/WhatsApp product behavior.
 */
export async function runReliabilitySelfHealing(input?: {
  organizationId?: string | null;
  now?: Date;
  deps?: ReliabilitySelfHealingDeps;
}): Promise<{
  closedLegacyScanLogs: number;
  closedGmailSyncScans: number;
  recordedEvents: number;
  resolvedEvents: number;
}> {
  const now = input?.now ?? new Date();
  const deps = input?.deps ?? {};
  const reapOverdueLegacyScanLogs =
    deps.reapOverdueLegacyScanLogs ?? reapOverdueLegacyScanLogsDefault;
  const closeStaleGmailScansForOrg =
    deps.closeStaleGmailScansForOrg ?? closeStaleGmailScansForOrgDefault;
  const countActiveGmailSyncScans =
    deps.countActiveGmailSyncScans ??
    (async (organizationId: string) =>
      prisma.syncLog.count({
        where: {
          organizationId,
          type: "gmail_scan",
          status: { in: ["queued", "running"] },
          finishedAt: null,
        },
      }));
  const countActiveLegacyScanLogs =
    deps.countActiveLegacyScanLogs ??
    (async (organizationId: string) =>
      prisma.scanLog.count({
        where: {
          orgId: organizationId,
          status: "running",
        },
      }));

  let closedLegacyScanLogs = 0;
  let closedGmailSyncScans = 0;
  let recordedEvents = 0;
  let resolvedEvents = 0;

  closedLegacyScanLogs = await reapOverdueLegacyScanLogs(now.getTime());
  if (closedLegacyScanLogs > 0) {
    const result = await recordReliabilityEvent({
      organizationId: input?.organizationId ?? null,
      module: "background_jobs",
      severity: closedLegacyScanLogs >= 5 ? "error" : "warning",
      errorCode: "LEGACY_SCANLOG_ZOMBIE",
      userVisibleMessage: "סריקות ישנות תקועות נוקו אוטומטית",
      technicalMessage: `watchdog closed ${closedLegacyScanLogs} orphan legacy ScanLog rows`,
      job: "legacy_scanlog_watchdog",
      customerVisible: true,
      autoHealed: true,
      metadata: { closed: closedLegacyScanLogs },
      now,
    });
    recordedEvents += 1;
    // Immediately resolve because healing already happened.
    await resolveReliabilityEvent({
      eventId: result.event.id,
      autoHealed: true,
      now,
    });
    resolvedEvents += 1;
  }

  if (input?.organizationId) {
    const closed = await closeStaleGmailScansForOrg(input.organizationId);
    closedGmailSyncScans = closed.length;
    if (closedGmailSyncScans > 0) {
      const fingerprint = buildReliabilityFingerprint({
        organizationId: input.organizationId,
        module: "gmail_scan",
        errorCode: "SCAN_JOB_STUCK",
        job: "gmail_sync_stale_close",
      });
      const recorded = await recordReliabilityEvent({
        organizationId: input.organizationId,
        module: "gmail_scan",
        severity: "warning",
        errorCode: "SCAN_JOB_STUCK",
        userVisibleMessage: "סריקת Gmail תקועה שוחררה אוטומטית",
        technicalMessage: `closed stale SyncLog scans: ${closed.join(",")}`,
        job: "gmail_sync_stale_close",
        customerVisible: true,
        autoHealed: true,
        fingerprint,
        metadata: { closedScanIds: closed },
        now,
      });
      recordedEvents += 1;
      await resolveReliabilityEvent({ eventId: recorded.event.id, autoHealed: true, now });
      resolvedEvents += 1;

      // Clear stale timeout banner signal when backend scan state is clean.
      await resolveReliabilityEvent({
        organizationId: input.organizationId,
        module: "dashboard",
        errorCode: "STALE_TIMEOUT_BANNER",
        autoHealed: true,
        now,
      });
    } else {
      // If no stuck scans remain for this org, clear any open stale-banner incident.
      const active = await countActiveGmailSyncScans(input.organizationId);
      const legacyActive = await countActiveLegacyScanLogs(input.organizationId);
      if (active === 0 && legacyActive === 0) {
        const resolved = await resolveReliabilityEvent({
          organizationId: input.organizationId,
          module: "dashboard",
          errorCode: "STALE_TIMEOUT_BANNER",
          autoHealed: true,
          now,
        });
        if (resolved) resolvedEvents += 1;
      }
    }
  }

  return { closedLegacyScanLogs, closedGmailSyncScans, recordedEvents, resolvedEvents };
}

export async function noteStaleDashboardBanner(input: {
  organizationId: string;
  userId?: string | null;
  reason?: string | null;
}) {
  return recordReliabilityEvent({
    organizationId: input.organizationId,
    userId: input.userId,
    module: "dashboard",
    severity: "warning",
    errorCode: "STALE_TIMEOUT_BANNER",
    userVisibleMessage: "באנר זמן-קצוב של סריקה נשאר אחרי שהמערכת כבר לא בסריקה",
    technicalMessage: input.reason ?? "stale dashboard timeout banner detected",
    component: "gmailScanBanner",
    customerVisible: true,
    metadata: { source: "dashboard_home" },
  });
}

export async function noteDocumentApprovalFailure(input: {
  organizationId: string;
  userId?: string | null;
  reviewId?: string | null;
  correlationId?: string | null;
  message: string;
}) {
  return recordReliabilityEvent({
    organizationId: input.organizationId,
    userId: input.userId,
    module: "document_review",
    severity: "error",
    errorCode: "DOCUMENT_APPROVAL_FAILED",
    userVisibleMessage: "אישור מסמך נכשל",
    technicalMessage: input.message,
    route: "POST /document-reviews/:id/approve",
    component: "approveFinancialDocumentReview",
    correlationId: input.correlationId,
    customerVisible: true,
    metadata: { reviewId: input.reviewId ?? null },
  });
}

export async function noteWhatsAppEmptyOrFailedReply(input: {
  organizationId?: string | null;
  correlationId?: string | null;
  reason: "empty_reply" | "processing_failed" | "safe_reply_failed";
  technicalMessage?: string | null;
}) {
  return recordReliabilityEvent({
    organizationId: input.organizationId ?? null,
    module: "whatsapp",
    severity: input.reason === "processing_failed" ? "error" : "warning",
    errorCode:
      input.reason === "empty_reply"
        ? "WHATSAPP_EMPTY_REPLY"
        : input.reason === "safe_reply_failed"
          ? "WHATSAPP_SAFE_REPLY_FAILED"
          : "WHATSAPP_WEBHOOK_FAILED",
    userVisibleMessage: "תשובת WhatsApp נכשלה או חזרה ריקה",
    technicalMessage: input.technicalMessage ?? input.reason,
    route: "/webhooks/twilio/whatsapp",
    component: "whatsapp_webhook",
    correlationId: input.correlationId,
    customerVisible: true,
  });
}
