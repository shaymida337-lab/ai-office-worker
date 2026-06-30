import test from "node:test";
import assert from "node:assert/strict";
import {
  gmailScanStillRunning,
  hasGmailScanBacklog,
  isPausedGmailScanStatus,
  isSuccessfulGmailScanProgress,
  isTerminalGmailScanProgress,
  isTerminalGmailScanStatus,
  isTerminalScanStatusLog,
  scanDocumentsFound,
} from "./gmailScanLifecycle.js";

test("scanDocumentsFound prefers documentsFound and includes needs-review items", () => {
  assert.equal(
    scanDocumentsFound({ documentsFound: 5, supplierPaymentsFound: 2, invoicesFound: 0 }),
    7
  );
  assert.equal(
    scanDocumentsFound({
      invoicesFound: 0,
      supplierPaymentsFound: 0,
      summary: { classifiedCount: 1, rejectedCount: 4 },
    }),
    5
  );
  assert.equal(scanDocumentsFound({ invoicesFound: 3, supplierPaymentsFound: 1 }), 4);
});

test("frontend polling stops on completed", () => {
  assert.equal(
    isTerminalGmailScanProgress({ status: "completed", finishedAt: "2026-01-01T00:00:00.000Z" }),
    true
  );
});

test("frontend polling stops on failed cancelled stale and paused", () => {
  assert.equal(isTerminalGmailScanStatus("failed"), true);
  assert.equal(isTerminalGmailScanStatus("cancelled"), true);
  assert.equal(isTerminalGmailScanStatus("stale"), true);
  assert.equal(isTerminalGmailScanStatus("paused"), true);
  assert.equal(isPausedGmailScanStatus("paused"), true);
  assert.equal(
    isTerminalGmailScanProgress({ status: "stale", finishedAt: "2026-01-01T00:00:00.000Z", inProgress: false }),
    true
  );
  assert.equal(
    isTerminalGmailScanProgress({ status: "paused", finishedAt: "2026-01-01T00:00:00.000Z", inProgress: false }),
    true
  );
});

test("frontend polling continues only for active running states", () => {
  assert.equal(gmailScanStillRunning({ status: "running", inProgress: true }), true);
  assert.equal(gmailScanStillRunning({ status: "queued", inProgress: true }), true);
  assert.equal(gmailScanStillRunning({ status: "completed", finishedAt: null, inProgress: false }), false);
});

test("completed scan with zero results is terminal progress", () => {
  assert.equal(
    isTerminalGmailScanProgress({
      status: "completed",
      finishedAt: "2026-06-25T12:00:00.000Z",
      inProgress: false,
      emailsFetched: 0,
      emailsSaved: 0,
    }),
    true
  );
  assert.equal(isSuccessfulGmailScanProgress({ status: "completed" }), true);
});

test("scan-status log terminal detection includes stale cancelled and paused", () => {
  assert.equal(isTerminalScanStatusLog({ status: "stale", endedAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(isTerminalScanStatusLog({ status: "cancelled", endedAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(isTerminalScanStatusLog({ status: "paused", endedAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(isTerminalScanStatusLog({ status: "running", endedAt: null }), false);
});

test("hasGmailScanBacklog detects paused and truncated completed scans", () => {
  assert.equal(hasGmailScanBacklog({ status: "paused", windowTruncated: true }), true);
  assert.equal(hasGmailScanBacklog({ status: "completed", windowTruncated: true }), true);
  assert.equal(hasGmailScanBacklog({ status: "completed", windowTruncated: false }), false);
});
