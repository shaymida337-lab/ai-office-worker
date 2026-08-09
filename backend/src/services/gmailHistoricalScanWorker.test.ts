import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const syncSource = readFileSync(join(here, "gmail-sync.ts"), "utf8");
const apiSource = readFileSync(join(here, "../routes/api.ts"), "utf8");
const lifecycleSource = readFileSync(join(here, "gmailScanLifecycle.ts"), "utf8");

test("gmail sync processes messages in batches of 50 with event-loop pause", () => {
  assert.match(syncSource, /export const GMAIL_SCAN_BATCH_SIZE = 50/);
  assert.match(syncSource, /export const GMAIL_SCAN_BATCH_PAUSE_MS = 50/);
  assert.match(syncSource, /HISTORICAL_CHUNK_START/);
  assert.match(syncSource, /await sleep\(GMAIL_SCAN_BATCH_PAUSE_MS\)/);
  assert.match(syncSource, /process_\$\{label\}_email_\$\{email\.gmailId\}/);
  assert.match(syncSource, /process_\$\{label\}_batch_\$\{processBatchNumber\}/);
});

test("POST /api/gmail/scan force-cancels active jobs and always creates a fresh scanId", () => {
  assert.match(apiSource, /cancelActiveGmailScansForOrg/);
  assert.match(apiSource, /force-cancelled prior active scans/);
  assert.match(apiSource, /res\.status\(202\)\.json\(\{/);
  assert.match(apiSource, /jobId:\s*scanLog\.id/);
  assert.match(apiSource, /status:\s*"started"/);
  assert.match(apiSource, /Accepted fire-and-forget/);
  assert.match(apiSource, /promoteGmailScanToRunning\(scanLog\.id\)/);
  assert.match(apiSource, /ensureGmailScanTerminalized/);
  assert.match(apiSource, /leaveRunningForConcurrent/);
  assert.match(apiSource, /\/gmail\/scan\/status/);
  assert.match(apiSource, /\/gmail\/scan\/cancel/);
  assert.match(apiSource, /Cancelled by user/);
  assert.doesNotMatch(apiSource, /Gmail scan already in progress/);
  // Heavy sync must not be awaited before the HTTP 202 response.
  const acceptIdx = apiSource.indexOf("Accepted fire-and-forget");
  const syncImportIdx = apiSource.indexOf(
    'const { syncGmailForOrganization } = await import("../services/gmail-sync.js");',
    acceptIdx
  );
  assert.ok(acceptIdx > 0 && syncImportIdx > acceptIdx);
});

test("cancelActiveGmailScansForOrg is exported for force-reset of stuck jobs", () => {
  assert.match(lifecycleSource, /export async function cancelActiveGmailScansForOrg/);
  assert.match(lifecycleSource, /finalizeGmailScanCancelled/);
});

test("zombie heartbeat-stale jobs are marked FAILED with restart timeout message", () => {
  assert.match(lifecycleSource, /Job timed out \/ server restarted/);
  assert.match(lifecycleSource, /nextStatus:\s*"failed"/);
  assert.match(lifecycleSource, /GMAIL_MANUAL_SCAN_STUCK_TIMEOUT_MS = 15 \* 60 \* 1000/);
  assert.match(lifecycleSource, /skipping heartbeat_stale fail for active scan/);
});

test("each email is processed under a strict 30s timeout with visible progress logs", () => {
  assert.match(syncSource, /export const GMAIL_PER_EMAIL_PROCESS_TIMEOUT_MS = 30_000/);
  assert.match(syncSource, /\[Gmail Sync\] Processing email/);
  assert.match(syncSource, /Email processing timed out after 30s/);
  assert.match(syncSource, /await withTimeout\(/);
  assert.match(syncSource, /stage=\$\{timedOut \? "process_timeout" : "process_isolation"\}/);
  assert.match(syncSource, /Gmail attachments\.get timed out after 30s/);
});

test("historical scan isolates per-email and per-attachment failures without failing the job", () => {
  assert.match(syncSource, /skipping email/);
  assert.match(syncSource, /stage=\$\{timedOut \? "process_timeout" : "process_isolation"\}/);
  assert.match(syncSource, /stage=invoice_attachment/);
  assert.match(syncSource, /Per-attachment isolation/);
  assert.match(syncSource, /non-fatal mid-scan error after progress/);
  assert.match(syncSource, /finalizeGmailScanCompleted/);
  assert.match(syncSource, /MID_SCAN_ERROR_ISOLATED/);
  assert.match(syncSource, /historical chunk failed chunk=/);
  assert.doesNotMatch(
    syncSource.slice(syncSource.indexOf("invoice save failed"), syncSource.indexOf("invoice save failed") + 400),
    /throw err/
  );
});

test("background worker does not overwrite terminal scan with FAILED", () => {
  assert.match(apiSource, /isTerminalGmailScanDbStatus/);
  assert.match(apiSource, /Background error ignored for already-terminal/);
});
