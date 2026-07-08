import { SCAN_CLIENT_STUCK_TIMEOUT_MS } from "@/lib/gmailScanLifecycle";

export const GMAIL_SCAN_POLL_INTERVAL_MS = 5000;
/**
 * Hard client bound matching backend GMAIL_SCAN_STUCK_TIMEOUT_MS.
 * Dashboard must never poll a "running" UI past this without a terminal backend status.
 */
export const MAX_GMAIL_SCAN_POLL_ATTEMPTS = Math.ceil(
  SCAN_CLIENT_STUCK_TIMEOUT_MS / GMAIL_SCAN_POLL_INTERVAL_MS
);
