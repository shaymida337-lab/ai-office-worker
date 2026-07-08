import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_SCANLOG_STALE_MS,
  reapOverdueLegacyScanLogs,
  reapOverdueLegacyScanLogsThrottled,
  resetLegacyScanLogReapThrottleForTests,
} from "./gmailScanLifecycle.js";
import { prisma } from "../lib/prisma.js";

test("watchdog closes only legacy running scans older than the stale cutoff", async () => {
  const original = prisma.scanLog.updateMany;
  let capturedWhere: Record<string, unknown> | null = null;
  let capturedData: Record<string, unknown> | null = null;
  (prisma.scanLog.updateMany as unknown) = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    capturedWhere = args.where;
    capturedData = args.data;
    return { count: 12 };
  };
  try {
    const now = Date.parse("2026-07-08T08:00:00.000Z");
    const closed = await reapOverdueLegacyScanLogs(now);
    assert.equal(closed, 12);
    assert.equal((capturedWhere as Record<string, unknown> | null)?.status, "running");
    const startedAt = (capturedWhere as { startedAt?: { lt?: Date } } | null)?.startedAt;
    assert.equal(startedAt?.lt?.getTime(), now - LEGACY_SCANLOG_STALE_MS);
    const data = capturedData as Record<string, unknown> | null;
    assert.equal(data?.status, "failed");
    assert.ok(data?.endedAt instanceof Date, "endedAt must be set — terminal state requires an end time");
    assert.match(String(data?.errors), /watchdog/);
  } finally {
    (prisma.scanLog.updateMany as unknown) = original;
  }
});

test("throttled watchdog runs at most once per window (idempotent under polling)", async () => {
  const original = prisma.scanLog.updateMany;
  let calls = 0;
  (prisma.scanLog.updateMany as unknown) = async () => {
    calls += 1;
    return { count: 0 };
  };
  try {
    resetLegacyScanLogReapThrottleForTests();
    const t0 = Date.parse("2026-07-08T08:00:00.000Z");
    await reapOverdueLegacyScanLogsThrottled(t0);
    await reapOverdueLegacyScanLogsThrottled(t0 + 60_000); // בתוך חלון 5 הדקות
    await reapOverdueLegacyScanLogsThrottled(t0 + 4 * 60_000);
    assert.equal(calls, 1, "must not re-run within the throttle window");
    await reapOverdueLegacyScanLogsThrottled(t0 + 6 * 60_000); // אחרי החלון
    assert.equal(calls, 2);
  } finally {
    (prisma.scanLog.updateMany as unknown) = original;
    resetLegacyScanLogReapThrottleForTests();
  }
});

test("second reap after cleanup finds nothing (terminal states are stable)", async () => {
  const original = prisma.scanLog.updateMany;
  (prisma.scanLog.updateMany as unknown) = async () => ({ count: 0 });
  try {
    const closed = await reapOverdueLegacyScanLogs(Date.now());
    assert.equal(closed, 0);
  } finally {
    (prisma.scanLog.updateMany as unknown) = original;
  }
});
