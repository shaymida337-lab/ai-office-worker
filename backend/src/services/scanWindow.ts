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

/** Floor for deep historical listings — above the incremental 500-message sync cap. */
export const HISTORICAL_SCAN_MAX_MESSAGES_FLOOR = 1_000;
/** Hard cap so a 5y fullScan cannot unbounded-list the entire mailbox in one run. */
export const HISTORICAL_SCAN_MAX_MESSAGES_CAP = 10_000;
/** Candidate budget per day for historical listing (Gmail returns newest-first). */
export const HISTORICAL_SCAN_MESSAGES_PER_DAY = 15;

/**
 * Scale listing budget with lookback. Without this, MAX_MESSAGES_PER_SYNC (500)
 * truncates busy inboxes to ~1 month even when daysBack is 365+.
 */
export function resolveHistoricalGmailMaxMessages(daysBack: number): number {
  const days = Math.max(1, Math.ceil(Number(daysBack) || 1));
  const scaled = Math.ceil(days * HISTORICAL_SCAN_MESSAGES_PER_DAY);
  return Math.min(
    HISTORICAL_SCAN_MAX_MESSAGES_CAP,
    Math.max(HISTORICAL_SCAN_MAX_MESSAGES_FLOOR, scaled)
  );
}

export function sinceDateFromDaysBack(daysBack: number, now = new Date()): Date {
  const days = Math.max(1, Math.ceil(Number(daysBack) || 1));
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function resolveHistoricalGmailScanWindow(input: {
  hasExplicitDaysBack: boolean;
  rawDaysBack: number;
  rescanInvoices: boolean;
  now?: Date;
}): { since: Date | undefined; daysBack: number } {
  const now = input.now ?? new Date();
  if (input.rescanInvoices) {
    const daysBack = 90;
    return { since: sinceDateFromDaysBack(daysBack, now), daysBack };
  }
  if (input.hasExplicitDaysBack) {
    const daysBack = Math.ceil(input.rawDaysBack);
    // Prefer after:YYYY/MM/DD over newer_than:Nd for long windows (exact day boundary).
    return { since: sinceDateFromDaysBack(daysBack, now), daysBack };
  }
  const initialWindow = initialConnectScanWindow(now);
  return { since: initialWindow.since, daysBack: initialWindow.daysBack };
}
