import { SCAN_CLIENT_STUCK_TIMEOUT_MS } from "@/lib/gmailScanLifecycle";

export const GMAIL_SCAN_POLL_INTERVAL_MS = 5000;
/**
 * Hard client bound matching backend GMAIL_SCAN_STUCK_TIMEOUT_MS.
 * Dashboard must never poll a "running" UI past this without a terminal backend status.
 */
export const MAX_GMAIL_SCAN_POLL_ATTEMPTS = Math.ceil(
  SCAN_CLIENT_STUCK_TIMEOUT_MS / GMAIL_SCAN_POLL_INTERVAL_MS
);

/** Historical/manual scans may run up to the backend cooperative 4h deadline. */
export const HISTORICAL_GMAIL_SCAN_POLL_MAX_MS = 4 * 60 * 60 * 1000;
export const HISTORICAL_GMAIL_SCAN_POLL_MAX_ATTEMPTS = Math.ceil(
  HISTORICAL_GMAIL_SCAN_POLL_MAX_MS / GMAIL_SCAN_POLL_INTERVAL_MS
);
