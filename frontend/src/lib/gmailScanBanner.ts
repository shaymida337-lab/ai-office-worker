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

export type ScanBannerStatus = "running" | "success" | "partial" | "truncated" | "paused" | "stale" | "error";

// באנר כשל/timeout ישן לא נשאר על המסך לנצח: אחרי שעה בלי סריקה פעילה — המערכת התאוששה
export const SCAN_FAILURE_BANNER_TTL_MS = 60 * 60 * 1000;

export function isScanFailureStillRelevant(
  log: Pick<ScanStatusLog, "endedAt">,
  now: number = Date.now(),
  ttlMs: number = SCAN_FAILURE_BANNER_TTL_MS
): boolean {
  if (!log.endedAt) return false;
  const endedAt = Date.parse(log.endedAt);
  if (!Number.isFinite(endedAt)) return false;
  return now - endedAt <= ttlMs;
}

export type ScanBannerState = {
  status: ScanBannerStatus;
  found: number;
  scanned: number;
  totalMatched?: number | null;
  errors: number;
};

export function formatScanBannerText(
  status: ScanBannerStatus,
  found: number,
  scanned: number,
  totalMatched: number | null | undefined,
  errors: number
): string {
  if (status === "running") {
    return `נטלי סורקת את המייל שלך… עברתי על ${scanned} מיילים ומצאתי ${found} מסמכים`;
  }
  if (status === "success") {
    if (found === 0 && scanned > 0) {
      return `הסריקה הסתיימה — עברתי על ${scanned} מיילים ולא מצאתי מסמכים חדשים`;
    }
    return `הסריקה הסתיימה — עברתי על ${scanned} מיילים ומצאתי ${found} מסמכים`;
  }
  if (status === "partial") {
    return `הסריקה הסתיימה עם ${errors} בעיות שדורשות בדיקה — עברתי על ${scanned} מיילים ומצאתי ${found} מסמכים`;
  }
  if (status === "stale") {
    return "הסריקה הקודמת לא הסתיימה. אפשר לנסות שוב מתי שנוח לך.";
  }
  if (status === "paused") {
    return `עברתי על ${scanned} מתוך ${totalMatched ?? scanned} מיילים — נשאר עוד. אפשר להריץ סריקה נוספת כשתרצה.`;
  }
  if (status === "truncated") {
    return `הסריקה הסתיימה חלקית — עברתי על ${scanned} מתוך ${totalMatched ?? scanned} מיילים ומצאתי ${found} מסמכים. מומלץ להריץ סריקה נוספת`;
  }
  return "הסריקה לא הושלמה. נסה שוב בעוד רגע, ונטלי תמשיך מאיפה שעצרנו";
}

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
  now: number = Date.now()
): ScanBannerState | null {
  if (activeScan) {
    return {
      status: mapProgressToBannerStatus(activeScan),
      found: scanDocumentsFound(activeScan),
      scanned: activeScan.emailsFetched ?? 0,
      totalMatched: activeScan.totalMatched ?? activeScan.summary?.totalMatched,
      errors: activeScan.summary?.errorsCount ?? activeScan.finalSummary?.errorsCount ?? 0,
    };
  }

  if (!scanStatus?.last) return null;

  if (isRunningScanStatusLog(scanStatus.last)) {
    return {
      status: "running",
      found: (scanStatus.last.invoicesFound ?? 0) + (scanStatus.last.paymentsFound ?? 0),
      scanned: scanStatus.last.found,
      totalMatched: scanStatus.last.totalMatched,
      errors: scanStatus.last.errors ? 1 : 0,
    };
  }

  const lastStatus: ScanBannerStatus =
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
              : "error";

  // סריקה שנכשלה/לא הסתיימה מזמן היא היסטוריה, לא מצב נוכחי — בלי באנר
  if ((lastStatus === "stale" || lastStatus === "error") && !isScanFailureStillRelevant(scanStatus.last, now)) {
    return null;
  }

  return {
    status: lastStatus,
    found: (scanStatus.last.invoicesFound ?? 0) + (scanStatus.last.paymentsFound ?? 0),
    scanned: scanStatus.last.found,
    totalMatched: scanStatus.last.totalMatched,
    errors: scanStatus.last.errors ? 1 : 0,
  };
}

function mapProgressToBannerStatus(
  progress: ScanProgressLike
): ScanBannerStatus {
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
