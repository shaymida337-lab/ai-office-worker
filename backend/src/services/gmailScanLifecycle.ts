import { prisma } from "../lib/prisma.js";
import { buildIncrementalGmailScanWindow } from "./scanWindow.js";
import {
  completeJobRun,
  failJobRun,
  heartbeatJobRun,
  startJobRun,
} from "./jobRunLifecycle.js";

export const GMAIL_SCAN_STALE_MS = 30 * 60 * 1000;
/** Manual/historical scans may list and process large mailboxes — keep a generous cooperative deadline. */
export const GMAIL_MANUAL_SCAN_DEADLINE_MS = 4 * 60 * 60 * 1000;
/**
 * Hard recovery bound for dashboard/API safety:
 * a queued/running scan with no completion and no fresh heartbeat cannot remain open forever.
 * Prisma SyncLog.updatedAt is the heartbeat (touched by progress writes + explicit touches).
 */
export const GMAIL_SCAN_STUCK_TIMEOUT_MS = 3 * 60 * 1000;
export const SCAN_STALE_TIMEOUT_REASON = "scan_stale_timeout";
const GMAIL_SCAN_JOB_TYPE = "gmail_scan";

export const GMAIL_SCAN_ACTIVE_STATUSES = ["queued", "running"] as const;
export const GMAIL_SCAN_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "stale",
  "paused",
  "timed_out",
  // legacy rows
  "success",
  "partial",
  "error",
] as const;

/**
 * Watchdog לטבלת ScanLog הישנה (סריקות scheduler: quick/daily/health).
 * שורש ה-P0: לשורות "running" בטבלה הזו אין שום מנגנון סגירה — תהליך שמת
 * באמצע (deploy של Render) משאיר זומבי לנצח, ו-/automation/scan-status מגיש
 * אותו לדשבורד ⇒ "סורק..." אינסופי. הראיה: 12 שורות running בגיל 34-946 שעות.
 * SyncLog לא זקוק לזה — יש לו closeStaleGmailScansForOrg (אומת: 0 פעילים תקועים).
 */
/** Legacy ScanLog has no heartbeat — close zombies after the same hard stuck bound. */
export const LEGACY_SCANLOG_STALE_MS = GMAIL_SCAN_STUCK_TIMEOUT_MS;
const LEGACY_SCANLOG_REAP_INTERVAL_MS = 5 * 60 * 1000;
let lastLegacyReapAtMs = 0;

export async function reapOverdueLegacyScanLogs(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - LEGACY_SCANLOG_STALE_MS);
  const result = await prisma.scanLog.updateMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    data: {
      status: "failed",
      endedAt: new Date(now),
      errors: "watchdog: scan interrupted (process restart or hang)",
    },
  });
  if (result.count > 0) {
    console.warn(`[scan-watchdog] closed ${result.count} orphan legacy ScanLog rows (running > ${LEGACY_SCANLOG_STALE_MS / 60000}min)`);
  }
  return result.count;
}

/** גרסה ממוסתת — לכל היותר ריצה אחת ל-5 דקות פר-אינסטנס (נקראת מכל קריאת scan-status). */
export async function reapOverdueLegacyScanLogsThrottled(now = Date.now()): Promise<number> {
  if (now - lastLegacyReapAtMs < LEGACY_SCANLOG_REAP_INTERVAL_MS) return 0;
  lastLegacyReapAtMs = now;
  return reapOverdueLegacyScanLogs(now);
}

export function resetLegacyScanLogReapThrottleForTests() {
  lastLegacyReapAtMs = 0;
}

export type GmailScanLifecycleStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale"
  | "paused"
  | "timed_out";

export type GmailScanAuthoritativeStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled";

export type GmailScanProgressCounters = {
  emailsProcessed?: number;
  emailsSaved?: number;
  invoicesFound?: number;
  paymentsCreated?: number;
  tasksCreated?: number;
  driveUploaded?: number;
  sheetsUpdated?: number;
  errorsCount?: number;
  windowTruncated?: boolean;
  totalMatched?: number | null;
};

export type GmailScanLifecyclePhase = "fetch" | "process";

export type GmailScanStopReason = "deadline" | "stuck_timeout" | "external_terminal";

export type GmailScanLifecycleTelemetryEvent =
  | "scan_started"
  | "scan_paused_deadline"
  | "scan_completed"
  | "scan_failed"
  | "scan_stale"
  | "scan_timed_out";

export type GmailScanLifecycleTelemetry = {
  scanId: string;
  organizationId?: string;
  scanMode?: string | null;
  phase?: GmailScanLifecyclePhase | null;
  emailsProcessed?: number;
  emailsSaved?: number;
  totalMatched?: number | null;
  elapsedMs?: number;
  reason?: string | null;
};

export function logScanLifecycle(
  scanId: string | null | undefined,
  event: string,
  detail?: string
) {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[scan] ${event} scanId=${scanId ?? "none"}${suffix}`);
}

export function logGmailScanLifecycleEvent(
  event: GmailScanLifecycleTelemetryEvent,
  payload: GmailScanLifecycleTelemetry
) {
  console.log(`[gmail-scan-lifecycle] ${event} ${JSON.stringify(payload)}`);
}

export function isActiveGmailScanStatus(status: string) {
  return (GMAIL_SCAN_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isTerminalGmailScanDbStatus(status: string) {
  return (GMAIL_SCAN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Long scans that may legitimately run until the cooperative deadline. */
export function isNormalLongGmailScanMode(scanMode?: string | null) {
  return scanMode !== "fast_recurring";
}

export function gmailScanDeadlineMs(scanMode?: string | null) {
  if (scanMode === "fast_recurring") {
    return GMAIL_SCAN_STALE_MS;
  }
  if (isNormalLongGmailScanMode(scanMode)) {
    return GMAIL_MANUAL_SCAN_DEADLINE_MS;
  }
  return GMAIL_SCAN_STALE_MS;
}

export function isGmailScanLogStale(startedAt: Date, now = Date.now(), scanMode?: string | null) {
  return startedAt.getTime() <= now - gmailScanDeadlineMs(scanMode);
}

/** Heartbeat age — SyncLog.updatedAt is bumped by progress writes and explicit touches. */
export function gmailScanLastProgressAt(log: {
  updatedAt?: Date | null;
  startedAt: Date;
}): Date {
  return log.updatedAt ?? log.startedAt;
}

/**
 * Hard invariant: queued/running cannot remain open forever.
 * Close when startedAt is older than stuckMs OR lastProgressAt is older than stuckMs.
 * Fresh heartbeats do not extend past the hard total-runtime bound.
 */
export function isGmailScanStuckWithoutProgress(
  log: {
    startedAt: Date;
    updatedAt?: Date | null;
    emailsProcessed?: number;
  },
  now = Date.now(),
  stuckMs = GMAIL_SCAN_STUCK_TIMEOUT_MS
): boolean {
  const startedMs = log.startedAt.getTime();
  if (!Number.isFinite(startedMs) || now - startedMs >= stuckMs) {
    return true;
  }
  const lastProgressMs = gmailScanLastProgressAt(log).getTime();
  if (!Number.isFinite(lastProgressMs)) return true;
  return now - lastProgressMs >= stuckMs;
}

/**
 * Read-side overdue close:
 * - stuck (no heartbeat / 3m): timed_out (dashboard must recover)
 * - fast_recurring past cooperative deadline: stale
 * - honest long scans past cooperative deadline: paused
 */
export function classifyOverdueGmailScanClose(log: {
  scanMode?: string | null;
  emailsProcessed?: number;
  startedAt?: Date;
  updatedAt?: Date | null;
}, now = Date.now()): "paused" | "stale" | "timed_out" {
  if (
    log.startedAt &&
    isGmailScanStuckWithoutProgress(
      {
        startedAt: log.startedAt,
        updatedAt: log.updatedAt,
        emailsProcessed: log.emailsProcessed,
      },
      now
    )
  ) {
    return "timed_out";
  }
  if (log.scanMode === "fast_recurring") {
    return "stale";
  }
  if (isNormalLongGmailScanMode(log.scanMode)) {
    return "paused";
  }
  return (log.emailsProcessed ?? 0) === 0 ? "stale" : "paused";
}

export function shouldFinalizeGmailScanAsPausedOnDeadline(
  startedAt: Date,
  deadlineTruncated: boolean,
  now = Date.now(),
  scanMode?: string | null
) {
  return deadlineTruncated || isGmailScanLogStale(startedAt, now, scanMode);
}

export function gmailScanCountersFromLog(log: {
  emailsProcessed: number;
  emailsSaved: number;
  invoicesFound: number;
  paymentsCreated: number;
  tasksCreated: number;
  driveUploaded: number;
  sheetsUpdated: number;
  errorsCount: number;
  totalMatched?: number | null;
  windowTruncated?: boolean;
}): GmailScanProgressCounters {
  return {
    emailsProcessed: log.emailsProcessed,
    emailsSaved: log.emailsSaved,
    invoicesFound: log.invoicesFound,
    paymentsCreated: log.paymentsCreated,
    tasksCreated: log.tasksCreated,
    driveUploaded: log.driveUploaded,
    sheetsUpdated: log.sheetsUpdated,
    errorsCount: log.errorsCount,
    totalMatched: log.totalMatched,
    windowTruncated: log.windowTruncated,
  };
}

export function mergeGmailScanWindowTruncated(listingTruncated: boolean, deadlineTruncated: boolean) {
  return listingTruncated || deadlineTruncated;
}

export function isGmailScanSuccessCursor(log: { status: string; windowTruncated?: boolean | null }) {
  return (
    (log.status === "success" || log.status === "completed") &&
    !log.windowTruncated
  );
}

export async function findLastGmailScanSuccessCursor(organizationId: string) {
  return prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "gmail_scan",
      status: { in: ["success", "completed"] },
      windowTruncated: false,
      finishedAt: { not: null },
    },
    orderBy: { finishedAt: "desc" },
    select: { id: true, finishedAt: true, status: true, windowTruncated: true },
  });
}

export async function resolveIncrementalGmailScanWindow(organizationId: string, now = new Date()) {
  const [lastSuccess, integration] = await Promise.all([
    findLastGmailScanSuccessCursor(organizationId),
    prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "gmail" } },
      select: { connectedAt: true },
    }),
  ]);

  return buildIncrementalGmailScanWindow({
    lastSuccessFinishedAt: lastSuccess?.finishedAt ?? null,
    connectedAt: integration?.connectedAt ?? null,
    now,
  });
}

export async function checkGmailScanShouldStop(
  scanId: string,
  startedAt: Date,
  scanMode?: string | null,
  now = Date.now()
): Promise<{ stop: boolean; reason?: GmailScanStopReason }> {
  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, type: "gmail_scan" },
    select: { status: true, finishedAt: true, scanMode: true, updatedAt: true },
  });
  if (!log) {
    return { stop: true, reason: "external_terminal" };
  }
  const mode = scanMode ?? log.scanMode;
  if (
    isGmailScanStuckWithoutProgress(
      {
        startedAt,
        updatedAt: (log as { updatedAt?: Date | null }).updatedAt,
      },
      now
    )
  ) {
    return { stop: true, reason: "stuck_timeout" };
  }
  if (isGmailScanLogStale(startedAt, now, mode)) {
    return { stop: true, reason: "deadline" };
  }
  if (log.finishedAt || isTerminalGmailScanDbStatus(log.status)) {
    return { stop: true, reason: "external_terminal" };
  }
  return { stop: false };
}

export function normalizeLegacyGmailScanStatus(status: string): GmailScanLifecycleStatus {
  if (status === "success" || status === "partial") return "completed";
  if (status === "error") return "failed";
  if (status === "timed_out") return "timed_out";
  if (
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "stale" ||
    status === "paused"
  ) {
    return status;
  }
  return "failed";
}

export function toApiGmailScanStatus(
  status: string,
  options: { errorsCount?: number; errorMessage?: string | null } = {}
):
  | "running"
  | "completed"
  | "partial"
  | "error"
  | "failed"
  | "cancelled"
  | "stale"
  | "paused"
  | "queued"
  | "timed_out" {
  const normalized = normalizeLegacyGmailScanStatus(status);
  if (normalized === "queued") return "queued";
  if (normalized === "running") return "running";
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "timed_out") return "timed_out";
  if (normalized === "stale") return "stale";
  if (normalized === "paused") return "paused";
  if (normalized === "failed") return "error";
  if (normalized === "completed") {
    return (options.errorsCount ?? 0) > 0 ? "partial" : "completed";
  }
  if (/stale|timeout|timed_out/i.test(options.errorMessage ?? "")) return "timed_out";
  return "error";
}

export function toAuthoritativeGmailScanStatus(
  status: string | null | undefined
): GmailScanAuthoritativeStatus {
  if (!status) return "idle";
  const normalized = normalizeLegacyGmailScanStatus(status);
  if (normalized === "queued") return "queued";
  if (normalized === "running") return "running";
  if (normalized === "completed") return "completed";
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "timed_out" || normalized === "stale" || normalized === "paused") {
    return "timed_out";
  }
  return "failed";
}

export async function findActiveGmailScanLog(organizationId: string, excludeScanId?: string) {
  return prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "gmail_scan",
      status: { in: [...GMAIL_SCAN_ACTIVE_STATUSES] },
      finishedAt: null,
      ...(excludeScanId ? { id: { not: excludeScanId } } : {}),
    },
    orderBy: { startedAt: "desc" },
  });
}

export async function closeOverdueActiveGmailScan(
  log: {
    id: string;
    startedAt: Date;
    updatedAt?: Date | null;
    scanMode?: string | null;
    emailsProcessed: number;
    emailsSaved: number;
    invoicesFound: number;
    paymentsCreated: number;
    tasksCreated: number;
    driveUploaded: number;
    sheetsUpdated: number;
    errorsCount: number;
    totalMatched?: number | null;
  },
  now = Date.now()
): Promise<"paused" | "stale" | "timed_out" | null> {
  const stuck = isGmailScanStuckWithoutProgress(log, now);
  const overdue = isGmailScanLogStale(log.startedAt, now, log.scanMode);
  if (!stuck && !overdue) {
    return null;
  }

  const counters = gmailScanCountersFromLog(log);
  const closeAs = classifyOverdueGmailScanClose(log, now);
  const previousStatus = "running";
  if (closeAs === "timed_out") {
    await finalizeGmailScanTimedOut(log.id, SCAN_STALE_TIMEOUT_REASON, counters, {
      reason: SCAN_STALE_TIMEOUT_REASON,
    });
    logGmailScanTransition({
      organizationId: undefined,
      scanId: log.id,
      previousStatus,
      nextStatus: "timed_out",
      reason: SCAN_STALE_TIMEOUT_REASON,
      startedAt: log.startedAt,
      lastProgressAt: gmailScanLastProgressAt(log),
      currentStage: stuck ? "heartbeat_stale" : "deadline",
      processedEmails: log.emailsProcessed,
      savedDocuments: log.emailsSaved,
      durationMs: Math.max(0, now - log.startedAt.getTime()),
    });
  } else if (closeAs === "paused") {
    await finalizeGmailScanPaused(log.id, { ...counters, windowTruncated: true }, {
      reason: "deadline_read_side",
    });
  } else {
    const deadlineMinutes = gmailScanDeadlineMs(log.scanMode) / 60_000;
    await finalizeGmailScanStale(
      log.id,
      `Scan exceeded ${deadlineMinutes} minute timeout without finishing`
    );
  }
  return closeAs;
}

export function logGmailScanTransition(input: {
  organizationId?: string;
  scanId: string;
  previousStatus: string;
  nextStatus: string;
  reason: string;
  startedAt?: Date | null;
  lastProgressAt?: Date | null;
  currentStage?: string | null;
  processedEmails?: number;
  savedDocuments?: number;
  durationMs?: number;
  error?: string | null;
}) {
  console.log(
    `[gmail-scan-transition] ${JSON.stringify({
      organizationId: input.organizationId ?? null,
      scanId: input.scanId,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
      reason: input.reason,
      startedAt: input.startedAt?.toISOString() ?? null,
      lastProgressAt: input.lastProgressAt?.toISOString() ?? null,
      currentStage: input.currentStage ?? null,
      processedEmails: input.processedEmails ?? null,
      savedDocuments: input.savedDocuments ?? null,
      durationMs: input.durationMs ?? null,
      error: input.error ?? null,
    })}`
  );
}

export async function closeStaleGmailScansForOrg(organizationId: string, excludeScanId?: string) {
  const activeLogs = await prisma.syncLog.findMany({
    where: {
      organizationId,
      type: "gmail_scan",
      status: { in: [...GMAIL_SCAN_ACTIVE_STATUSES] },
      finishedAt: null,
      ...(excludeScanId ? { id: { not: excludeScanId } } : {}),
    },
  });

  const closed: string[] = [];
  for (const log of activeLogs) {
    const result = await closeOverdueActiveGmailScan(log);
    if (result) closed.push(log.id);
  }
  return closed;
}

export async function createQueuedGmailScanLog(
  organizationId: string,
  scanMode: string,
  retryOfId?: string
) {
  const existing = await findActiveGmailScanLog(organizationId);
  if (existing) {
    const now = Date.now();
    if (
      isGmailScanStuckWithoutProgress(existing, now) ||
      isGmailScanLogStale(existing.startedAt, now, existing.scanMode)
    ) {
      await closeOverdueActiveGmailScan(existing, now);
    } else {
      logScanLifecycle(existing.id, "queued", "reusing existing active scan");
      return { scanLog: existing, created: false as const };
    }
  }

  const scanLog = await prisma.syncLog.create({
    data: {
      organizationId,
      type: "gmail_scan",
      status: "queued",
      scanMode,
      retryOfId,
    },
  });
  logScanLifecycle(scanLog.id, "created");
  await startJobRun({
    organizationId,
    jobType: GMAIL_SCAN_JOB_TYPE,
    referenceId: scanLog.id,
    timeoutMs: gmailScanDeadlineMs(scanMode),
    payloadJson: {
      scanMode,
      retryOfId: retryOfId ?? null,
    },
  });
  logScanLifecycle(scanLog.id, "queued");
  logGmailScanTransition({
    organizationId,
    scanId: scanLog.id,
    previousStatus: "idle",
    nextStatus: "queued",
    reason: "manual_or_scheduled_start",
    startedAt: scanLog.startedAt,
    lastProgressAt: scanLog.startedAt,
    currentStage: "queued",
    processedEmails: 0,
    savedDocuments: 0,
    durationMs: 0,
  });
  return { scanLog, created: true as const };
}

export async function promoteGmailScanToRunning(scanId: string) {
  const existing = await prisma.syncLog.findFirst({
    where: { id: scanId, type: "gmail_scan" },
    select: { organizationId: true, scanMode: true, startedAt: true, status: true },
  });
  const updated = await prisma.syncLog.updateMany({
    where: {
      id: scanId,
      type: "gmail_scan",
      status: { in: ["queued", "running"] },
      finishedAt: null,
    },
    data: { status: "running", errorMessage: null, updatedAt: new Date() },
  });
  if (updated.count > 0) {
    await heartbeatJobRun({
      jobType: GMAIL_SCAN_JOB_TYPE,
      referenceId: scanId,
      timeoutMs: gmailScanDeadlineMs(existing?.scanMode),
    });
    logScanLifecycle(scanId, "running");
    if (existing) {
      logGmailScanTransition({
        organizationId: existing.organizationId,
        scanId,
        previousStatus: existing.status,
        nextStatus: "running",
        reason: "promote_to_running",
        startedAt: existing.startedAt,
        lastProgressAt: new Date(),
        currentStage: "running",
        durationMs: Math.max(0, Date.now() - existing.startedAt.getTime()),
      });
      logGmailScanLifecycleEvent("scan_started", {
        scanId,
        organizationId: existing.organizationId,
        scanMode: existing.scanMode,
        elapsedMs: 0,
      });
    }
  }
  return updated.count > 0;
}

/** Explicit heartbeat when stage changes without counter movement. */
export async function touchGmailScanHeartbeat(
  scanId: string,
  stage: string,
  organizationId?: string
) {
  const result = await prisma.syncLog.updateMany({
    where: {
      id: scanId,
      type: "gmail_scan",
      status: { in: [...GMAIL_SCAN_ACTIVE_STATUSES] },
      finishedAt: null,
    },
    data: { updatedAt: new Date() },
  });
  if (result.count > 0) {
    await heartbeatJobRun({
      jobType: GMAIL_SCAN_JOB_TYPE,
      referenceId: scanId,
    });
    logScanLifecycle(scanId, "heartbeat", `stage=${stage}`);
    if (organizationId) {
      logGmailScanTransition({
        organizationId,
        scanId,
        previousStatus: "running",
        nextStatus: "running",
        reason: `heartbeat:${stage}`,
        lastProgressAt: new Date(),
        currentStage: stage,
      });
    }
  }
  return result.count > 0;
}

type TerminalizeTelemetryContext = {
  phase?: GmailScanLifecyclePhase | null;
  reason?: string | null;
};

function lifecycleTelemetryEventForStatus(
  status: GmailScanLifecycleStatus
): GmailScanLifecycleTelemetryEvent | null {
  if (status === "completed") return "scan_completed";
  if (status === "paused") return "scan_paused_deadline";
  if (status === "failed") return "scan_failed";
  if (status === "stale") return "scan_stale";
  if (status === "timed_out") return "scan_timed_out";
  return null;
}

async function terminalizeGmailScan(
  scanId: string,
  status: GmailScanLifecycleStatus,
  errorMessage: string | null,
  counters: GmailScanProgressCounters = {},
  telemetry: TerminalizeTelemetryContext = {}
) {
  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, type: "gmail_scan" },
    select: {
      status: true,
      finishedAt: true,
      startedAt: true,
      organizationId: true,
      scanMode: true,
    },
  });
  if (!log || log.finishedAt || isTerminalGmailScanDbStatus(log.status)) {
    return false;
  }

  await prisma.syncLog.update({
    where: { id: scanId },
    data: {
      status,
      errorMessage,
      finishedAt: new Date(),
      ...counters,
    },
  });
  logScanLifecycle(scanId, status, errorMessage ? `reason=${errorMessage}` : undefined);
  if (log.organizationId) {
    const { safeInvalidateDashboardBootstrap } = await import("./dashboardBootstrapCache.js");
    safeInvalidateDashboardBootstrap(undefined, log.organizationId);
    const { safeInvalidateInvoicesBootstrap } = await import("./invoices/invoiceBootstrapCache.js");
    safeInvalidateInvoicesBootstrap(undefined, log.organizationId);
  }
  if (status === "completed") {
    await completeJobRun({ jobType: GMAIL_SCAN_JOB_TYPE, referenceId: scanId });
  } else if (status === "failed") {
    await failJobRun({
      jobType: GMAIL_SCAN_JOB_TYPE,
      referenceId: scanId,
      errorMessage,
    });
  } else {
    await failJobRun({
      jobType: GMAIL_SCAN_JOB_TYPE,
      referenceId: scanId,
      errorMessage: errorMessage ?? status,
    });
  }
  logGmailScanTransition({
    organizationId: log.organizationId,
    scanId,
    previousStatus: log.status,
    nextStatus: status,
    reason: telemetry.reason ?? errorMessage ?? status,
    startedAt: log.startedAt,
    lastProgressAt: new Date(),
    currentStage: telemetry.phase ?? status,
    processedEmails: counters.emailsProcessed,
    savedDocuments: counters.emailsSaved,
    durationMs: Math.max(0, Date.now() - log.startedAt.getTime()),
    error: errorMessage,
  });

  const telemetryEvent = lifecycleTelemetryEventForStatus(status);
  if (telemetryEvent) {
    logGmailScanLifecycleEvent(telemetryEvent, {
      scanId,
      organizationId: log.organizationId,
      scanMode: log.scanMode,
      phase: telemetry.phase ?? null,
      emailsProcessed: counters.emailsProcessed,
      emailsSaved: counters.emailsSaved,
      totalMatched: counters.totalMatched,
      elapsedMs: Math.max(0, Date.now() - log.startedAt.getTime()),
      reason: telemetry.reason ?? errorMessage,
    });
  }

  return true;
}

export async function finalizeGmailScanCompleted(
  scanId: string,
  counters: GmailScanProgressCounters = {},
  telemetry: TerminalizeTelemetryContext = {}
) {
  return terminalizeGmailScan(scanId, "completed", null, counters, telemetry);
}

export async function finalizeGmailScanPaused(
  scanId: string,
  counters: GmailScanProgressCounters = {},
  telemetry: TerminalizeTelemetryContext = {}
) {
  return terminalizeGmailScan(scanId, "paused", null, counters, {
    ...telemetry,
    reason: telemetry.reason ?? "deadline",
  });
}

export async function finalizeGmailScanWithDeadlineGuard(
  scanId: string,
  startedAt: Date,
  deadlineTruncated: boolean,
  counters: GmailScanProgressCounters = {},
  telemetry: TerminalizeTelemetryContext = {}
) {
  const mode = (
    await prisma.syncLog.findFirst({
      where: { id: scanId, type: "gmail_scan" },
      select: { scanMode: true },
    })
  )?.scanMode;
  if (shouldFinalizeGmailScanAsPausedOnDeadline(startedAt, deadlineTruncated, Date.now(), mode)) {
    return finalizeGmailScanPaused(
      scanId,
      { ...counters, windowTruncated: true },
      telemetry
    );
  }
  return finalizeGmailScanCompleted(scanId, counters, telemetry);
}

export async function finalizeGmailScanFailed(
  scanId: string,
  errorMessage: string,
  counters: GmailScanProgressCounters = {},
  telemetry: TerminalizeTelemetryContext = {}
) {
  return terminalizeGmailScan(scanId, "failed", errorMessage, {
    errorsCount: Math.max(counters.errorsCount ?? 0, 1),
    ...counters,
  }, {
    ...telemetry,
    reason: telemetry.reason ?? errorMessage,
  });
}

export async function finalizeGmailScanStale(scanId: string, errorMessage: string) {
  return terminalizeGmailScan(scanId, "stale", errorMessage, {}, {
    reason: errorMessage,
  });
}

export async function finalizeGmailScanTimedOut(
  scanId: string,
  errorMessage: string = SCAN_STALE_TIMEOUT_REASON,
  counters: GmailScanProgressCounters = {},
  telemetry: TerminalizeTelemetryContext = {}
) {
  return terminalizeGmailScan(scanId, "timed_out", errorMessage, counters, {
    ...telemetry,
    reason: telemetry.reason ?? errorMessage,
  });
}

export async function finalizeGmailScanCancelled(scanId: string, errorMessage: string) {
  return terminalizeGmailScan(scanId, "cancelled", errorMessage);
}

export async function ensureGmailScanTerminalized(scanId: string, fallbackMessage?: string) {
  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, type: "gmail_scan" },
    select: {
      status: true,
      finishedAt: true,
      startedAt: true,
      scanMode: true,
      updatedAt: true,
      emailsProcessed: true,
    },
  });
  if (!log || log.finishedAt || isTerminalGmailScanDbStatus(log.status)) {
    return false;
  }
  const now = Date.now();
  if (
    isGmailScanStuckWithoutProgress(log, now) ||
    isGmailScanLogStale(log.startedAt, now, log.scanMode)
  ) {
    const full = await prisma.syncLog.findFirst({
      where: { id: scanId, type: "gmail_scan" },
    });
    if (full) {
      const closeAs = await closeOverdueActiveGmailScan(full, now);
      if (closeAs) return true;
    }
    return finalizeGmailScanTimedOut(
      scanId,
      fallbackMessage ?? SCAN_STALE_TIMEOUT_REASON
    );
  }
  return finalizeGmailScanFailed(
    scanId,
    fallbackMessage ?? "Scan terminated without completion"
  );
}

export async function terminalizeOrphanGmailScan(scanId: string, reason: string) {
  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, type: "gmail_scan" },
    select: { status: true, finishedAt: true, startedAt: true },
  });
  if (!log || log.finishedAt || isTerminalGmailScanDbStatus(log.status)) {
    return false;
  }
  return finalizeGmailScanCancelled(scanId, reason);
}

export async function refreshGmailScanProgressOnRead(organizationId: string, scanId: string) {
  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, organizationId, type: "gmail_scan" },
  });
  if (!log || log.finishedAt || !isActiveGmailScanStatus(log.status)) {
    return log;
  }
  const now = Date.now();
  if (
    !isGmailScanStuckWithoutProgress(log, now) &&
    !isGmailScanLogStale(log.startedAt, now, log.scanMode)
  ) {
    return log;
  }
  await closeOverdueActiveGmailScan(log, now);
  return prisma.syncLog.findFirst({
    where: { id: scanId, organizationId, type: "gmail_scan" },
  });
}

export async function handleConcurrentGmailScanExit(options: {
  organizationId: string;
  scanLogId?: string;
  activeScanId: string;
}) {
  if (options.scanLogId && options.scanLogId !== options.activeScanId) {
    await terminalizeOrphanGmailScan(
      options.scanLogId,
      `Cancelled because scan ${options.activeScanId} is already active`
    );
  }
  logScanLifecycle(options.activeScanId, "running", "concurrent scan reused");
  return options.activeScanId;
}
