export function isCompletedGmailScanStatus(status?: string) {
  return status === "completed" || status === "success" || status === "partial";
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
  return isCompletedGmailScanStatus(status) || isFailedGmailScanStatus(status);
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
    | "success"
) {
  if (logStatus === "success" || logStatus === "completed") return "completed";
  if (logStatus === "partial") return "partial";
  if (logStatus === "stale") return "stale";
  if (logStatus === "cancelled") return "cancelled";
  if (logStatus === "queued") return "queued";
  if (logStatus === "failed" || logStatus === "error") return "error";
  return fallback;
}
