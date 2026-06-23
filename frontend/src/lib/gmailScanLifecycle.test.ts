import test from "node:test";
import assert from "node:assert/strict";
import {
  gmailScanStillRunning,
  isTerminalGmailScanProgress,
  isTerminalGmailScanStatus,
  isTerminalScanStatusLog,
} from "./gmailScanLifecycle.js";

test("frontend polling stops on completed", () => {
  assert.equal(
    isTerminalGmailScanProgress({ status: "completed", finishedAt: "2026-01-01T00:00:00.000Z" }),
    true
  );
});

test("frontend polling stops on failed cancelled and stale", () => {
  assert.equal(isTerminalGmailScanStatus("failed"), true);
  assert.equal(isTerminalGmailScanStatus("cancelled"), true);
  assert.equal(isTerminalGmailScanStatus("stale"), true);
  assert.equal(
    isTerminalGmailScanProgress({ status: "stale", finishedAt: "2026-01-01T00:00:00.000Z", inProgress: false }),
    true
  );
});

test("frontend polling continues only for active running states", () => {
  assert.equal(gmailScanStillRunning({ status: "running", inProgress: true }), true);
  assert.equal(gmailScanStillRunning({ status: "queued", inProgress: true }), true);
  assert.equal(gmailScanStillRunning({ status: "completed", finishedAt: null, inProgress: false }), false);
});

test("scan-status log terminal detection includes stale and cancelled", () => {
  assert.equal(isTerminalScanStatusLog({ status: "stale", endedAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(isTerminalScanStatusLog({ status: "cancelled", endedAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(isTerminalScanStatusLog({ status: "running", endedAt: null }), false);
});
