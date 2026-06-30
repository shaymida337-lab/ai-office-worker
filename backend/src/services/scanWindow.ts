export function startOfCurrentMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

export function daysBackFromDate(start: Date, now = new Date()) {
  const diffMs = Math.max(0, now.getTime() - start.getTime());
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export const INCREMENTAL_SCAN_FALLBACK_DAYS = 7;

export type IncrementalGmailScanCursorSource = "last_success" | "connected_at" | "fallback_7d";

export function initialConnectScanWindow(now = new Date()) {
  const since = startOfCurrentMonth(now);
  return {
    since,
    daysBack: daysBackFromDate(since, now),
  };
}

export function isHistoricalGmailScanRequest(input: {
  historical?: boolean;
  rescanInvoices?: boolean;
  hasExplicitDaysBack?: boolean;
  rawDaysBack?: number;
}) {
  if (input.rescanInvoices) return true;
  if (input.historical === true) return true;
  if (input.hasExplicitDaysBack && (input.rawDaysBack ?? 0) >= 30) return true;
  return false;
}

export function incrementalFallbackWindow(connectedAt: Date | null, now = new Date()) {
  const since =
    connectedAt ?? new Date(now.getTime() - INCREMENTAL_SCAN_FALLBACK_DAYS * 24 * 60 * 60 * 1000);
  return {
    since,
    daysBack: daysBackFromDate(since, now),
  };
}

export function buildIncrementalGmailScanWindow(input: {
  lastSuccessFinishedAt: Date | null;
  connectedAt: Date | null;
  now?: Date;
}): { since: Date; daysBack: number; cursorSource: IncrementalGmailScanCursorSource } {
  const now = input.now ?? new Date();
  if (input.lastSuccessFinishedAt) {
    return {
      since: input.lastSuccessFinishedAt,
      daysBack: daysBackFromDate(input.lastSuccessFinishedAt, now),
      cursorSource: "last_success",
    };
  }
  const fallback = incrementalFallbackWindow(input.connectedAt, now);
  return {
    since: fallback.since,
    daysBack: fallback.daysBack,
    cursorSource: input.connectedAt ? "connected_at" : "fallback_7d",
  };
}

export function resolveHistoricalGmailScanWindow(input: {
  hasExplicitDaysBack: boolean;
  rawDaysBack: number;
  rescanInvoices: boolean;
  now?: Date;
}): { since: Date | undefined; daysBack: number } {
  if (input.rescanInvoices) {
    return { since: undefined, daysBack: 90 };
  }
  if (input.hasExplicitDaysBack) {
    return { since: undefined, daysBack: Math.ceil(input.rawDaysBack) };
  }
  const initialWindow = initialConnectScanWindow(input.now);
  return { since: initialWindow.since, daysBack: initialWindow.daysBack };
}
