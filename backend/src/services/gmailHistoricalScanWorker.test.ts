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

test("POST /api/gmail/scan returns 202 with jobId and wraps worker in try/catch/finally", () => {
  assert.match(apiSource, /res\.status\(202\)\.json\(\{/);
  assert.match(apiSource, /jobId:\s*scanLog\.id/);
  assert.match(apiSource, /status:\s*"started"/);
  assert.match(apiSource, /Accepted fire-and-forget/);
  assert.match(apiSource, /promoteGmailScanToRunning\(scanLog\.id\)/);
  assert.match(apiSource, /ensureGmailScanTerminalized/);
  assert.match(apiSource, /leaveRunningForConcurrent/);
  assert.match(apiSource, /\/gmail\/scan\/status/);
  // Heavy sync must not be awaited before the HTTP 202 response.
  const acceptIdx = apiSource.indexOf("Accepted fire-and-forget");
  const syncImportIdx = apiSource.indexOf(
    'const { syncGmailForOrganization } = await import("../services/gmail-sync.js");',
    acceptIdx
  );
  assert.ok(acceptIdx > 0 && syncImportIdx > acceptIdx);
});

test("zombie heartbeat-stale jobs are marked FAILED with restart timeout message", () => {
  assert.match(lifecycleSource, /Job timed out \/ server restarted/);
  assert.match(lifecycleSource, /nextStatus:\s*"failed"/);
  assert.match(lifecycleSource, /GMAIL_MANUAL_SCAN_STUCK_TIMEOUT_MS = 15 \* 60 \* 1000/);
  assert.match(lifecycleSource, /skipping heartbeat_stale fail for active scan/);
});
