import { GMAIL_MANUAL_SCAN_DEADLINE_MS } from "./gmailScanDeadlines";

export const GMAIL_SCAN_POLL_INTERVAL_MS = 5000;
/** Match backend manual-scan cooperative deadline so the UI never gives up first. */
export const MAX_GMAIL_SCAN_POLL_ATTEMPTS = Math.ceil(
  GMAIL_MANUAL_SCAN_DEADLINE_MS / GMAIL_SCAN_POLL_INTERVAL_MS
);
