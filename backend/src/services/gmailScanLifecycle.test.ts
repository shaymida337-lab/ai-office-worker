import test from "node:test";
import assert from "node:assert/strict";
import {
  GMAIL_SCAN_STALE_MS,
  isActiveGmailScanStatus,
  isGmailScanLogStale,
  isGmailScanSuccessCursor,
  isTerminalGmailScanDbStatus,
  mergeGmailScanWindowTruncated,
  normalizeLegacyGmailScanStatus,
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

test("isGmailScanLogStale uses 30 minute threshold", () => {
  const now = Date.now();
  assert.equal(isGmailScanLogStale(new Date(now - GMAIL_SCAN_STALE_MS - 1), now), true);
  assert.equal(isGmailScanLogStale(new Date(now - 5 * 60 * 1000), now), false);
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
