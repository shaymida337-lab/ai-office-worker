import test from "node:test";
import assert from "node:assert/strict";
import {
  GMAIL_MANUAL_SCAN_DEADLINE_MS,
  GMAIL_SCAN_STALE_MS,
  classifyOverdueGmailScanClose,
  gmailScanDeadlineMs,
  isActiveGmailScanStatus,
  isGmailScanLogStale,
  isGmailScanSuccessCursor,
  isTerminalGmailScanDbStatus,
  mergeGmailScanWindowTruncated,
  normalizeLegacyGmailScanStatus,
  shouldFinalizeGmailScanAsPausedOnDeadline,
  toApiGmailScanStatus,
} from "./gmailScanLifecycle.js";

test("normalizeLegacyGmailScanStatus maps legacy rows", () => {
  assert.equal(normalizeLegacyGmailScanStatus("success"), "completed");
  assert.equal(normalizeLegacyGmailScanStatus("partial"), "completed");
  assert.equal(normalizeLegacyGmailScanStatus("error"), "failed");
  assert.equal(normalizeLegacyGmailScanStatus("stale"), "stale");
  assert.equal(normalizeLegacyGmailScanStatus("paused"), "paused");
});

test("toApiGmailScanStatus maps completed with errors to partial", () => {
  assert.equal(toApiGmailScanStatus("completed", { errorsCount: 2 }), "partial");
  assert.equal(toApiGmailScanStatus("completed", { errorsCount: 0 }), "completed");
  assert.equal(toApiGmailScanStatus("failed"), "error");
  assert.equal(toApiGmailScanStatus("stale"), "stale");
  assert.equal(toApiGmailScanStatus("paused"), "paused");
  assert.equal(toApiGmailScanStatus("cancelled"), "cancelled");
  assert.equal(toApiGmailScanStatus("queued"), "queued");
  assert.equal(toApiGmailScanStatus("running"), "running");
});

test("isGmailScanLogStale uses mode-aware thresholds", () => {
  const now = Date.now();
  assert.equal(isGmailScanLogStale(new Date(now - GMAIL_SCAN_STALE_MS - 1), now, "fast_recurring"), true);
  assert.equal(isGmailScanLogStale(new Date(now - 5 * 60 * 1000), now, "fast_recurring"), false);
  assert.equal(
    isGmailScanLogStale(new Date(now - GMAIL_MANUAL_SCAN_DEADLINE_MS - 1), now, "manual"),
    true
  );
  assert.equal(
    isGmailScanLogStale(new Date(now - GMAIL_SCAN_STALE_MS - 1), now, "manual"),
    false
  );
  assert.equal(gmailScanDeadlineMs("manual"), GMAIL_MANUAL_SCAN_DEADLINE_MS);
  assert.equal(gmailScanDeadlineMs("fast_recurring"), GMAIL_SCAN_STALE_MS);
});

test("active and terminal status helpers", () => {
  assert.equal(isActiveGmailScanStatus("queued"), true);
  assert.equal(isActiveGmailScanStatus("running"), true);
  assert.equal(isActiveGmailScanStatus("completed"), false);
  assert.equal(isActiveGmailScanStatus("paused"), false);
  assert.equal(isTerminalGmailScanDbStatus("completed"), true);
  assert.equal(isTerminalGmailScanDbStatus("paused"), true);
  assert.equal(isTerminalGmailScanDbStatus("stale"), true);
  assert.equal(isTerminalGmailScanDbStatus("running"), false);
});

test("isGmailScanSuccessCursor excludes paused stale and truncated completed", () => {
  assert.equal(isGmailScanSuccessCursor({ status: "completed", windowTruncated: false }), true);
  assert.equal(isGmailScanSuccessCursor({ status: "success", windowTruncated: false }), true);
  assert.equal(isGmailScanSuccessCursor({ status: "completed", windowTruncated: true }), false);
  assert.equal(isGmailScanSuccessCursor({ status: "paused", windowTruncated: true }), false);
  assert.equal(isGmailScanSuccessCursor({ status: "stale", windowTruncated: false }), false);
});

test("mergeGmailScanWindowTruncated combines listing and deadline flags", () => {
  assert.equal(mergeGmailScanWindowTruncated(false, false), false);
  assert.equal(mergeGmailScanWindowTruncated(true, false), true);
  assert.equal(mergeGmailScanWindowTruncated(false, true), true);
  assert.equal(mergeGmailScanWindowTruncated(true, true), true);
});

test("classifyOverdueGmailScanClose pauses manual scans and stales fast recurring", () => {
  assert.equal(classifyOverdueGmailScanClose({ scanMode: "manual", emailsProcessed: 342 }), "paused");
  assert.equal(classifyOverdueGmailScanClose({ scanMode: "manual_incremental", emailsProcessed: 12 }), "paused");
  assert.equal(classifyOverdueGmailScanClose({ scanMode: "first_time", emailsProcessed: 12 }), "paused");
  assert.equal(classifyOverdueGmailScanClose({ scanMode: "manual", emailsProcessed: 0 }), "paused");
  assert.equal(classifyOverdueGmailScanClose({ scanMode: "fast_recurring", emailsProcessed: 2 }), "stale");
});

test("shouldFinalizeGmailScanAsPausedOnDeadline uses manual deadline for long scans", () => {
  const startedAt = new Date("2026-06-30T16:34:07.783Z");
  const afterFastDeadline = startedAt.getTime() + GMAIL_SCAN_STALE_MS + 5_000;
  assert.equal(
    shouldFinalizeGmailScanAsPausedOnDeadline(startedAt, false, afterFastDeadline, "fast_recurring"),
    true
  );
  assert.equal(
    shouldFinalizeGmailScanAsPausedOnDeadline(startedAt, false, afterFastDeadline, "manual"),
    false
  );
  assert.equal(shouldFinalizeGmailScanAsPausedOnDeadline(startedAt, true, startedAt.getTime() + 60_000, "manual"), true);
  assert.equal(
    shouldFinalizeGmailScanAsPausedOnDeadline(startedAt, false, startedAt.getTime() + 10 * 60_000, "manual"),
    false
  );
  const afterManualDeadline = startedAt.getTime() + GMAIL_MANUAL_SCAN_DEADLINE_MS + 5_000;
  assert.equal(
    shouldFinalizeGmailScanAsPausedOnDeadline(startedAt, false, afterManualDeadline, "manual"),
    true
  );
});

test("read-side paused manual scan maps to API paused not stale", () => {
  assert.equal(toApiGmailScanStatus("paused"), "paused");
  assert.equal(
    toApiGmailScanStatus("paused", { errorMessage: "Scan exceeded 30 minute timeout (auto-closed on read)" }),
    "paused"
  );
});
