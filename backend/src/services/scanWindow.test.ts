import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIncrementalGmailScanWindow,
  incrementalFallbackWindow,
  initialConnectScanWindow,
  INCREMENTAL_SCAN_FALLBACK_DAYS,
  isHistoricalGmailScanRequest,
  resolveHistoricalGmailScanWindow,
  startOfCurrentMonth,
} from "./scanWindow.js";

test("initial connect scan starts at first day of current month", () => {
  const now = new Date(2026, 5, 15, 14, 30, 0, 0);
  const window = initialConnectScanWindow(now);

  assert.deepEqual(window.since, new Date(2026, 5, 1, 0, 0, 0, 0));
  assert.equal(window.daysBack, 15);
});

test("start of current month is not a 90 day lookback", () => {
  const now = new Date(2026, 5, 15, 14, 30, 0, 0);
  const ninetyDaysBack = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  assert.notDeepEqual(startOfCurrentMonth(now), ninetyDaysBack);
  assert.deepEqual(startOfCurrentMonth(now), new Date(2026, 5, 1, 0, 0, 0, 0));
});

test("isHistoricalGmailScanRequest distinguishes incremental vs deep scan triggers", () => {
  assert.equal(isHistoricalGmailScanRequest({ rescanInvoices: true }), true);
  assert.equal(isHistoricalGmailScanRequest({ historical: true }), true);
  assert.equal(
    isHistoricalGmailScanRequest({ hasExplicitDaysBack: true, rawDaysBack: 30 }),
    true
  );
  assert.equal(
    isHistoricalGmailScanRequest({ hasExplicitDaysBack: true, rawDaysBack: 90 }),
    true
  );
  assert.equal(
    isHistoricalGmailScanRequest({ hasExplicitDaysBack: true, rawDaysBack: 7 }),
    false
  );
  assert.equal(isHistoricalGmailScanRequest({}), false);
});

test("buildIncrementalGmailScanWindow prefers last successful scan cursor", () => {
  const now = new Date("2026-06-30T17:00:00.000Z");
  const lastSuccessFinishedAt = new Date("2026-06-30T16:30:00.000Z");
  const window = buildIncrementalGmailScanWindow({
    lastSuccessFinishedAt,
    connectedAt: new Date("2026-01-01T00:00:00.000Z"),
    now,
  });

  assert.equal(window.cursorSource, "last_success");
  assert.equal(window.since.toISOString(), lastSuccessFinishedAt.toISOString());
  assert.equal(window.daysBack, 1);
});

test("buildIncrementalGmailScanWindow falls back to connectedAt then 7 days", () => {
  const now = new Date("2026-06-30T17:00:00.000Z");
  const connectedAt = new Date("2026-06-20T10:00:00.000Z");

  const fromConnected = buildIncrementalGmailScanWindow({
    lastSuccessFinishedAt: null,
    connectedAt,
    now,
  });
  assert.equal(fromConnected.cursorSource, "connected_at");
  assert.equal(fromConnected.since.toISOString(), connectedAt.toISOString());

  const fromFallback = buildIncrementalGmailScanWindow({
    lastSuccessFinishedAt: null,
    connectedAt: null,
    now,
  });
  assert.equal(fromFallback.cursorSource, "fallback_7d");
  const expectedSince = new Date(now.getTime() - INCREMENTAL_SCAN_FALLBACK_DAYS * 24 * 60 * 60 * 1000);
  assert.equal(fromFallback.since.toISOString(), expectedSince.toISOString());
});

test("incrementalFallbackWindow uses seven day floor when Gmail is not connected yet", () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const window = incrementalFallbackWindow(null, now);
  assert.equal(window.daysBack, INCREMENTAL_SCAN_FALLBACK_DAYS);
});

test("resolveHistoricalGmailScanWindow keeps explicit deep scan semantics", () => {
  const now = new Date(2026, 5, 15, 14, 30, 0, 0);

  assert.deepEqual(resolveHistoricalGmailScanWindow({ hasExplicitDaysBack: false, rawDaysBack: 0, rescanInvoices: true }), {
    since: undefined,
    daysBack: 90,
  });
  assert.deepEqual(
    resolveHistoricalGmailScanWindow({ hasExplicitDaysBack: true, rawDaysBack: 90, rescanInvoices: false }),
    { since: undefined, daysBack: 90 }
  );
  const monthWindow = resolveHistoricalGmailScanWindow({
    hasExplicitDaysBack: false,
    rawDaysBack: 0,
    rescanInvoices: false,
    now,
  });
  assert.deepEqual(monthWindow.since, new Date(2026, 5, 1, 0, 0, 0, 0));
  assert.equal(monthWindow.daysBack, 15);
});
