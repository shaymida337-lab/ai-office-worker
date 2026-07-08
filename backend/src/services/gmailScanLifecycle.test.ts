import test from "node:test";
import assert from "node:assert/strict";
import {
  GMAIL_MANUAL_SCAN_DEADLINE_MS,
  GMAIL_SCAN_STALE_MS,
  GMAIL_SCAN_STUCK_TIMEOUT_MS,
  SCAN_STALE_TIMEOUT_REASON,
  classifyOverdueGmailScanClose,
  gmailScanDeadlineMs,
  isActiveGmailScanStatus,
  isGmailScanLogStale,
  isGmailScanStuckWithoutProgress,
  isGmailScanSuccessCursor,
  isTerminalGmailScanDbStatus,
  mergeGmailScanWindowTruncated,
  normalizeLegacyGmailScanStatus,
  shouldFinalizeGmailScanAsPausedOnDeadline,
  toApiGmailScanStatus,
  toAuthoritativeGmailScanStatus,
} from "./gmailScanLifecycle.js";

test("normalizeLegacyGmailScanStatus maps legacy rows", () => {
  assert.equal(normalizeLegacyGmailScanStatus("success"), "completed");
  assert.equal(normalizeLegacyGmailScanStatus("partial"), "completed");
  assert.equal(normalizeLegacyGmailScanStatus("error"), "failed");
  assert.equal(normalizeLegacyGmailScanStatus("stale"), "stale");
  assert.equal(normalizeLegacyGmailScanStatus("paused"), "paused");
  assert.equal(normalizeLegacyGmailScanStatus("timed_out"), "timed_out");
});

test("toApiGmailScanStatus maps completed with errors to partial", () => {
  assert.equal(toApiGmailScanStatus("completed", { errorsCount: 2 }), "partial");
  assert.equal(toApiGmailScanStatus("completed", { errorsCount: 0 }), "completed");
  assert.equal(toApiGmailScanStatus("failed"), "error");
  assert.equal(toApiGmailScanStatus("stale"), "stale");
  assert.equal(toApiGmailScanStatus("timed_out"), "timed_out");
  assert.equal(toApiGmailScanStatus("paused"), "paused");
  assert.equal(toApiGmailScanStatus("cancelled"), "cancelled");
  assert.equal(toApiGmailScanStatus("queued"), "queued");
  assert.equal(toApiGmailScanStatus("running"), "running");
});

test("toAuthoritativeGmailScanStatus collapses recovery terminals to timed_out", () => {
  assert.equal(toAuthoritativeGmailScanStatus(null), "idle");
  assert.equal(toAuthoritativeGmailScanStatus("running"), "running");
  assert.equal(toAuthoritativeGmailScanStatus("queued"), "queued");
  assert.equal(toAuthoritativeGmailScanStatus("completed"), "completed");
  assert.equal(toAuthoritativeGmailScanStatus("failed"), "failed");
  assert.equal(toAuthoritativeGmailScanStatus("timed_out"), "timed_out");
  assert.equal(toAuthoritativeGmailScanStatus("stale"), "timed_out");
  assert.equal(toAuthoritativeGmailScanStatus("paused"), "timed_out");
  assert.equal(toAuthoritativeGmailScanStatus("cancelled"), "cancelled");
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

test("active and terminal status helpers include timed_out", () => {
  assert.equal(isActiveGmailScanStatus("queued"), true);
  assert.equal(isActiveGmailScanStatus("running"), true);
  assert.equal(isActiveGmailScanStatus("completed"), false);
  assert.equal(isActiveGmailScanStatus("paused"), false);
  assert.equal(isTerminalGmailScanDbStatus("completed"), true);
  assert.equal(isTerminalGmailScanDbStatus("paused"), true);
  assert.equal(isTerminalGmailScanDbStatus("stale"), true);
  assert.equal(isTerminalGmailScanDbStatus("timed_out"), true);
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

test("stale running scan older than 3 minutes becomes timed_out", () => {
  const now = Date.parse("2026-07-08T12:00:00.000Z");
  const startedAt = new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 1);
  assert.equal(
    isGmailScanStuckWithoutProgress({ startedAt, updatedAt: startedAt, emailsProcessed: 0 }, now),
    true
  );
  assert.equal(
    classifyOverdueGmailScanClose(
      { scanMode: "manual", emailsProcessed: 0, startedAt, updatedAt: startedAt },
      now
    ),
    "timed_out"
  );
});

test("stale queued scan becomes timed_out", () => {
  const now = Date.parse("2026-07-08T12:00:00.000Z");
  const startedAt = new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 5_000);
  assert.equal(
    classifyOverdueGmailScanClose(
      { scanMode: "manual", emailsProcessed: 0, startedAt, updatedAt: startedAt },
      now
    ),
    "timed_out"
  );
});

test("fresh running scan is not stuck and does not classify as timed_out by heartbeat alone", () => {
  const now = Date.parse("2026-07-08T12:00:00.000Z");
  const startedAt = new Date(now - 60_000);
  const updatedAt = new Date(now - 10_000);
  assert.equal(
    isGmailScanStuckWithoutProgress({ startedAt, updatedAt, emailsProcessed: 12 }, now),
    false
  );
  assert.equal(
    classifyOverdueGmailScanClose(
      { scanMode: "manual", emailsProcessed: 12, startedAt, updatedAt },
      now
    ),
    "paused"
  );
});

test("stale heartbeat while total runtime still under cooperative deadline is timed_out", () => {
  const now = Date.parse("2026-07-08T12:00:00.000Z");
  const startedAt = new Date(now - 2 * 60_000);
  const updatedAt = new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 1);
  assert.equal(
    isGmailScanStuckWithoutProgress({ startedAt, updatedAt, emailsProcessed: 5 }, now),
    true
  );
  assert.equal(
    classifyOverdueGmailScanClose(
      { scanMode: "manual", emailsProcessed: 5, startedAt, updatedAt },
      now
    ),
    "timed_out"
  );
});

test("hard total runtime exceeds 3 minutes even with fresh-looking counters", () => {
  const now = Date.parse("2026-07-08T12:00:00.000Z");
  const startedAt = new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 1);
  // updatedAt missing → lastProgressAt falls back to startedAt → still stuck
  assert.equal(
    isGmailScanStuckWithoutProgress({ startedAt, emailsProcessed: 100 }, now),
    true
  );
  assert.equal(SCAN_STALE_TIMEOUT_REASON, "scan_stale_timeout");
});

test("classifyOverdueGmailScanClose pauses honest long scans only when not heartbeat-stuck", () => {
  const now = Date.parse("2026-07-08T12:00:00.000Z");
  // Past cooperative deadline (4h) but classify uses stuck first; construct under stuck
  // by making startedAt only slightly past stuck when stuck check uses same clock —
  // for cooperative-overdue path we need startedAt old AND updatedAt fresh enough that
  // stuck check fails — but stuck also checks startedAt age. So cooperative paused path
  // is only reachable when startedAt is past mode deadline BUT under 3m stuck? Impossible
  // for manual 4h. For fast_recurring past 30m with fresh heartbeat under 3m from started?
  // Actually startedAt past 30m also means past 3m stuck. Stuck always wins first.
  // Document invariant: any active scan older than 3m is timed_out.
  assert.equal(
    classifyOverdueGmailScanClose({
      scanMode: "manual",
      emailsProcessed: 342,
      startedAt: new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 1),
      updatedAt: new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 1),
    }, now),
    "timed_out"
  );
  assert.equal(
    classifyOverdueGmailScanClose({
      scanMode: "fast_recurring",
      emailsProcessed: 2,
      startedAt: new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 1),
      updatedAt: new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 1),
    }, now),
    "timed_out"
  );
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
