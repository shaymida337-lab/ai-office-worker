import type { ScanBannerStatus } from "@/lib/gmailScanBanner";

export type ScanStatusResolution<T> = {
  nextStatus: T | null;
  known: boolean;
  stale: boolean;
};

export function resolveScanStatusFromSettled<T>(
  previous: T | null,
  settled: PromiseSettledResult<T>
): ScanStatusResolution<T> {
  if (settled.status === "fulfilled") {
    return {
      nextStatus: settled.value,
      known: true,
      stale: false,
    };
  }
  if (previous) {
    return {
      nextStatus: previous,
      known: true,
      stale: true,
    };
  }
  return {
    nextStatus: null,
    known: false,
    stale: true,
  };
}

type ConfirmedSyncIssueInput = {
  reconnectRequired?: boolean;
  scanBannerStatus?: ScanBannerStatus | null;
  scanBannerErrors?: number;
  lastScanStatus?: string | null;
};

/** True only for explicit, confirmed sync failures — not backlog, unknown, or fetch noise. */
export function resolveConfirmedSyncIssue(input: ConfirmedSyncIssueInput): boolean {
  if (input.reconnectRequired) return true;
  if (input.scanBannerStatus === "error" || input.scanBannerStatus === "stale") return true;
  if (input.scanBannerStatus === "partial" && (input.scanBannerErrors ?? 0) > 0) return true;
  const last = input.lastScanStatus?.toLowerCase() ?? "";
  if (last === "failed" || last === "error") return true;
  return false;
}
