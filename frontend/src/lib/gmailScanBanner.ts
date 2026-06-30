import {
  gmailScanStillRunning,
  isCompletedGmailScanStatus,
  isPausedGmailScanStatus,
  isSuccessfulGmailScanProgress,
  isTerminalGmailScanProgress,
  isTerminalScanStatusLog,
  isRunningScanStatusLog,
  scanDocumentsFound,
} from "./gmailScanLifecycle";

export type ScanStatusLog = {
  id: string;
  status: string;
  found: number;
  saved: number;
  invoicesFound?: number;
  paymentsFound?: number;
  errors: string | null;
  windowTruncated?: boolean;
  totalMatched?: number | null;
  endedAt: string | null;
};

export type ScanProgressLike = {
  status?: string;
  inProgress?: boolean;
  finishedAt?: string | null;
  windowTruncated?: boolean;
  emailsFetched?: number;
  totalMatched?: number | null;
  summary?: {
    windowTruncated?: boolean;
    totalMatched?: number | null;
    errorsCount?: number;
    classifiedCount?: number;
    rejectedCount?: number;
    needsReviewCount?: number;
    documentsFound?: number;
    invoicesFound?: number;
  };
  finalSummary?: { errorsCount?: number } | null;
  documentsFound?: number;
  invoicesFound?: number;
  supplierPaymentsFound?: number;
};

export type ScanBannerState = {
  status: "running" | "success" | "partial" | "truncated" | "paused" | "stale" | "error";
  found: number;
  scanned: number;
  totalMatched?: number | null;
  errors: number;
};

export function resolveDashboardGmailScanRunning(input: {
  syncing: boolean;
  activeScanId: string | null;
  activeScan: ScanProgressLike | null;
  scanBanner: ScanBannerState | null;
  scanLogs?: ScanStatusLog[];
}): boolean {
  if (input.syncing) return true;

  if (input.activeScanId && input.scanLogs?.length) {
    const tracked = input.scanLogs.find((log) => log.id === input.activeScanId);
    if (tracked && isTerminalScanStatusLog(tracked)) {
      return false;
    }
  }

  if (input.activeScan && isTerminalGmailScanProgress(input.activeScan)) {
    return false;
  }

  if (input.activeScan && gmailScanStillRunning(input.activeScan)) {
    return true;
  }

  if (input.activeScanId && !input.activeScan) {
    return true;
  }

  if (input.scanBanner?.status === "running") {
    return true;
  }

  return false;
}

export function buildScanBannerState(
  activeScan: ScanProgressLike | null,
  scanStatus: { last: ScanStatusLog | null } | null,
  documentReviewCount = 0
): ScanBannerState | null {
  const withReviewFallback = (found: number) => Math.max(found, documentReviewCount);

  if (activeScan) {
    return {
      status: mapProgressToBannerStatus(activeScan),
      found: withReviewFallback(scanDocumentsFound(activeScan)),
      scanned: activeScan.emailsFetched ?? 0,
      totalMatched: activeScan.totalMatched ?? activeScan.summary?.totalMatched,
      errors: activeScan.summary?.errorsCount ?? activeScan.finalSummary?.errorsCount ?? 0,
    };
  }

  if (!scanStatus?.last) return null;

  if (isRunningScanStatusLog(scanStatus.last)) {
    return {
      status: "running",
      found: withReviewFallback(
        (scanStatus.last.invoicesFound ?? 0) + (scanStatus.last.paymentsFound ?? 0)
      ),
      scanned: scanStatus.last.found,
      totalMatched: scanStatus.last.totalMatched,
      errors: scanStatus.last.errors ? 1 : 0,
    };
  }

  return {
    status:
      scanStatus.last.status === "paused"
        ? "paused"
        : scanStatus.last.windowTruncated
          ? "truncated"
          : scanStatus.last.status === "stale" || scanStatus.last.status === "cancelled"
            ? "stale"
            : scanStatus.last.status === "success" || scanStatus.last.status === "completed"
              ? "success"
              : scanStatus.last.status === "partial"
                ? "partial"
                : "error",
    found: withReviewFallback(
      (scanStatus.last.invoicesFound ?? 0) + (scanStatus.last.paymentsFound ?? 0)
    ),
    scanned: scanStatus.last.found,
    totalMatched: scanStatus.last.totalMatched,
    errors: scanStatus.last.errors ? 1 : 0,
  };
}

function mapProgressToBannerStatus(
  progress: ScanProgressLike
): ScanBannerState["status"] {
  if (isTerminalGmailScanProgress(progress)) {
    if (isPausedGmailScanStatus(progress.status)) return "paused";
    const truncated = progress.windowTruncated ?? progress.summary?.windowTruncated ?? false;
    if (truncated) return "truncated";
    if (progress.status === "partial") return "partial";
    if (progress.status === "stale" || progress.status === "cancelled") return "stale";
    if (isSuccessfulGmailScanProgress(progress) || isCompletedGmailScanStatus(progress.status ?? "")) {
      return "success";
    }
    return "error";
  }

  if (gmailScanStillRunning(progress)) return "running";

  if (isPausedGmailScanStatus(progress.status)) return "paused";
  const truncated = progress.windowTruncated ?? progress.summary?.windowTruncated ?? false;
  if (truncated) return "truncated";
  if (progress.status === "partial") return "partial";
  if (progress.status === "stale" || progress.status === "cancelled") return "stale";
  if (isSuccessfulGmailScanProgress(progress)) return "success";
  return "error";
}

export { isSuccessfulGmailScanProgress };
