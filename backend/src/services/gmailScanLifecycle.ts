import { prisma } from "../lib/prisma.js";
import { buildIncrementalGmailScanWindow } from "./scanWindow.js";

export const GMAIL_SCAN_STALE_MS = 30 * 60 * 1000;

export const GMAIL_SCAN_ACTIVE_STATUSES = ["queued", "running"] as const;
export const GMAIL_SCAN_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "stale",
  "paused",
  // legacy rows
  "success",
  "partial",
  "error",
] as const;

export type GmailScanLifecycleStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale"
  | "paused";

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

export type GmailScanStopReason = "deadline" | "external_terminal";

export type GmailScanLifecycleTelemetryEvent =
  | "scan_started"
  | "scan_paused_deadline"
  | "scan_completed"
  | "scan_failed"
  | "scan_stale";

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

export function isGmailScanLogStale(startedAt: Date, now = Date.now()) {
  return startedAt.getTime() <= now - GMAIL_SCAN_STALE_MS;
}

/** Long scans that may legitimately run until the cooperative deadline. */
export function isNormalLongGmailScanMode(scanMode?: string | null) {
  return scanMode !== "fast_recurring";
}

/**
 * Read-side overdue close: pause honest long scans; reserve stale for orphans.
 */
export function classifyOverdueGmailScanClose(log: {
  scanMode?: string | null;
  emailsProcessed?: number;
}): "paused" | "stale" {
  if (log.scanMode === "fast_recurring") {
    return "stale";
  }
  if ((log.emailsProcessed ?? 0) === 0) {
    return "stale";
  }
  return "paused";
}

export function shouldFinalizeGmailScanAsPausedOnDeadline(
  startedAt: Date,
  deadlineTruncated: boolean,
  now = Date.now()
) {
  return deadlineTruncated || isGmailScanLogStale(startedAt, now);
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
  now = Date.now()
): Promise<{ stop: boolean; reason?: GmailScanStopReason }> {
  if (isGmailScanLogStale(startedAt, now)) {
    return { stop: true, reason: "deadline" };
  }

  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, type: "gmail_scan" },
    select: { status: true, finishedAt: true },
  });
  if (!log) {
    return { stop: true, reason: "external_terminal" };
  }
  if (log.finishedAt || isTerminalGmailScanDbStatus(log.status)) {
    return { stop: true, reason: "external_terminal" };
  }
  return { stop: false };
}

export function normalizeLegacyGmailScanStatus(status: string): GmailScanLifecycleStatus {
  if (status === "success" || status === "partial") return "completed";
  if (status === "error") return "failed";
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
): "running" | "completed" | "partial" | "error" | "failed" | "cancelled" | "stale" | "paused" | "queued" {
  const normalized = normalizeLegacyGmailScanStatus(status);
  if (normalized === "queued") return "queued";
  if (normalized === "running") return "running";
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "stale") return "stale";
  if (normalized === "paused") return "paused";
  if (normalized === "failed") return "error";
  if (normalized === "completed") {
    return (options.errorsCount ?? 0) > 0 ? "partial" : "completed";
  }
  if (/stale/i.test(options.errorMessage ?? "")) return "stale";
  return "error";
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
): Promise<"paused" | "stale" | null> {
  if (!isGmailScanLogStale(log.startedAt, now)) {
    return null;
  }

  const counters = gmailScanCountersFromLog(log);
  const closeAs = classifyOverdueGmailScanClose(log);
  if (closeAs === "paused") {
    await finalizeGmailScanPaused(log.id, { ...counters, windowTruncated: true }, {
      reason: "deadline_read_side",
    });
  } else {
    await finalizeGmailScanStale(
      log.id,
      `Scan exceeded ${GMAIL_SCAN_STALE_MS / 60_000} minute timeout without finishing`
    );
  }
  return closeAs;
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
    if (isGmailScanLogStale(existing.startedAt)) {
      await closeOverdueActiveGmailScan(existing);
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
  logScanLifecycle(scanLog.id, "queued");
  return { scanLog, created: true as const };
}

export async function promoteGmailScanToRunning(scanId: string) {
  const existing = await prisma.syncLog.findFirst({
    where: { id: scanId, type: "gmail_scan" },
    select: { organizationId: true, scanMode: true, startedAt: true },
  });
  const updated = await prisma.syncLog.updateMany({
    where: {
      id: scanId,
      type: "gmail_scan",
      status: { in: ["queued", "running"] },
      finishedAt: null,
    },
    data: { status: "running", errorMessage: null },
  });
  if (updated.count > 0) {
    logScanLifecycle(scanId, "running");
    if (existing) {
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
  if (shouldFinalizeGmailScanAsPausedOnDeadline(startedAt, deadlineTruncated)) {
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

export async function finalizeGmailScanCancelled(scanId: string, errorMessage: string) {
  return terminalizeGmailScan(scanId, "cancelled", errorMessage);
}

export async function ensureGmailScanTerminalized(scanId: string, fallbackMessage?: string) {
  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, type: "gmail_scan" },
    select: { status: true, finishedAt: true, startedAt: true },
  });
  if (!log || log.finishedAt || isTerminalGmailScanDbStatus(log.status)) {
    return false;
  }
  if (isGmailScanLogStale(log.startedAt)) {
    const full = await prisma.syncLog.findFirst({
      where: { id: scanId, type: "gmail_scan" },
    });
    if (full) {
      const closeAs = await closeOverdueActiveGmailScan(full);
      if (closeAs) return true;
    }
    return finalizeGmailScanStale(
      scanId,
      fallbackMessage ?? "Scan terminated without completion (stale timeout)"
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
  if (!isGmailScanLogStale(log.startedAt)) {
    return log;
  }
  await closeOverdueActiveGmailScan(log);
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
