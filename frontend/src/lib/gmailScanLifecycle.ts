export function scanDocumentsFound(progress: {
  documentsFound?: number;
  invoicesFound?: number;
  supplierPaymentsFound?: number;
  summary?: {
    classifiedCount?: number;
    rejectedCount?: number;
    documentsFound?: number;
    needsReviewCount?: number;
    invoicesFound?: number;
  };
}): number {
  if (typeof progress.documentsFound === "number") {
    return progress.documentsFound + (progress.supplierPaymentsFound ?? 0);
  }
  if (typeof progress.summary?.documentsFound === "number") {
    return progress.summary.documentsFound + (progress.supplierPaymentsFound ?? 0);
  }
  const fromSummary =
    (progress.summary?.classifiedCount ?? 0) +
    (progress.summary?.rejectedCount ?? progress.summary?.needsReviewCount ?? 0);
  if (fromSummary > 0) {
    return fromSummary + (progress.supplierPaymentsFound ?? 0);
  }
  return (progress.invoicesFound ?? progress.summary?.invoicesFound ?? 0) + (progress.supplierPaymentsFound ?? 0);
}

export function isCompletedGmailScanStatus(status?: string) {
  return status === "completed" || status === "success" || status === "partial";
}

export function isPausedGmailScanStatus(status?: string) {
  return status === "paused";
}

export function hasGmailScanBacklog(log: { status: string; windowTruncated?: boolean | null }) {
  return isPausedGmailScanStatus(log.status) || (isCompletedGmailScanStatus(log.status) && Boolean(log.windowTruncated));
}

export function isSuccessfulGmailScanProgress(progress: {
  status?: string;
}) {
  return (
    progress.status === "completed" ||
    progress.status === "success" ||
    progress.status === "partial"
  );
}

export function isFailedGmailScanStatus(status?: string) {
  return (
    status === "error" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "stale"
  );
}

export function isRunningGmailScanStatus(status?: string) {
  return status === "running" || status === "queued";
}

export function isTerminalGmailScanStatus(status?: string) {
  return isCompletedGmailScanStatus(status) || isFailedGmailScanStatus(status) || isPausedGmailScanStatus(status);
}

export function isTerminalGmailScanProgress(progress: {
  status?: string;
  finishedAt?: string | null;
  inProgress?: boolean;
}) {
  if (progress.finishedAt) return true;
  if (progress.inProgress === false) return true;
  return isTerminalGmailScanStatus(progress.status);
}

export function isTerminalScanStatusLog(log: { status: string; endedAt: string | null }) {
  if (log.endedAt) return true;
  return isTerminalGmailScanStatus(log.status);
}

export function isRunningScanStatusLog(log: { status: string; endedAt: string | null }) {
  return isRunningGmailScanStatus(log.status) && !log.endedAt;
}

/**
 * P0: לוג "running" עתיק הוא זומבי (תהליך שמת באמצע) — אסור לאמץ אותו כסריקה
 * פעילה ב-UI, אחרת הדשבורד מציג "סורק..." לנצח על סריקה שלא קיימת.
 */
export const SCAN_LOG_ADOPTION_MAX_AGE_MS = 30 * 60 * 1000;

export function isAdoptableRunningScanLog(
  log: { status: string; endedAt: string | null; startedAt?: string | Date | null },
  now = Date.now(),
  maxAgeMs = SCAN_LOG_ADOPTION_MAX_AGE_MS
) {
  if (!isRunningScanStatusLog(log)) return false;
  if (!log.startedAt) return true;
  const startedMs = new Date(log.startedAt).getTime();
  if (Number.isNaN(startedMs)) return true;
  return now - startedMs <= maxAgeMs;
}

export function gmailScanStillRunning(progress: {
  status?: string;
  finishedAt?: string | null;
  inProgress?: boolean;
}) {
  if (progress.inProgress === false) return false;
  if (progress.finishedAt) return false;
  if (isTerminalGmailScanProgress(progress)) return false;
  return isRunningGmailScanStatus(progress.status);
}

export function normalizeScanStatusFromLog(
  logStatus: string,
  fallback:
    | "running"
    | "queued"
    | "completed"
    | "partial"
    | "error"
    | "failed"
    | "cancelled"
    | "stale"
    | "paused"
    | "success"
) {
  if (logStatus === "success" || logStatus === "completed") return "completed";
  if (logStatus === "partial") return "partial";
  if (logStatus === "stale") return "stale";
  if (logStatus === "paused") return "paused";
  if (logStatus === "cancelled") return "cancelled";
  if (logStatus === "queued") return "queued";
  if (logStatus === "failed" || logStatus === "error") return "error";
  return fallback;
}
