import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import {
  completeJobRun,
  failJobRun,
  heartbeatJobRun,
  startJobRun,
  timeoutStaleJobRuns,
} from "./jobRunLifecycle.js";

test("startJobRun creates running row best-effort", async () => {
  const original = prisma.jobRun.create;
  let createdData: Record<string, unknown> | null = null;
  (prisma.jobRun.create as unknown) = async (args: { data: Record<string, unknown> }) => {
    createdData = args.data;
    return { id: "job_1" };
  };
  try {
    await startJobRun({
      organizationId: "org_1",
      jobType: "gmail_scan",
      referenceId: "scan_1",
      timeoutMs: 60_000,
      payloadJson: { source: "test" },
    });
    assert.equal(createdData?.jobType, "gmail_scan");
    assert.equal(createdData?.referenceId, "scan_1");
    assert.equal(createdData?.status, "running");
    assert.ok(createdData?.timeoutAt instanceof Date);
  } finally {
    (prisma.jobRun.create as unknown) = original;
  }
});

test("heartbeat/complete/fail update only running reference rows", async () => {
  const original = prisma.jobRun.updateMany;
  const calls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  (prisma.jobRun.updateMany as unknown) = async (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    calls.push(args);
    return { count: 1 };
  };
  try {
    await heartbeatJobRun({ jobType: "gmail_scan", referenceId: "scan_2", timeoutMs: 5000 });
    await completeJobRun({ jobType: "gmail_scan", referenceId: "scan_2" });
    await failJobRun({ jobType: "gmail_scan", referenceId: "scan_2", errorMessage: "boom" });
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(call.where.jobType, "gmail_scan");
      assert.equal(call.where.referenceId, "scan_2");
      assert.equal(call.where.status, "running");
    }
    assert.equal(calls[1]?.data.status, "completed");
    assert.equal(calls[2]?.data.status, "failed");
  } finally {
    (prisma.jobRun.updateMany as unknown) = original;
  }
});

test("timeoutStaleJobRuns marks running stale rows as timeout", async () => {
  const original = prisma.jobRun.updateMany;
  let where: Record<string, unknown> | null = null;
  let data: Record<string, unknown> | null = null;
  (prisma.jobRun.updateMany as unknown) = async (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    where = args.where;
    data = args.data;
    return { count: 2 };
  };
  try {
    const now = new Date("2026-07-09T11:45:00.000Z");
    const timedOut = await timeoutStaleJobRuns(now);
    assert.equal(timedOut, 2);
    assert.equal(where?.status, "running");
    assert.deepEqual(where?.timeoutAt, { lt: now });
    assert.equal(data?.status, "timeout");
    assert.equal(data?.errorMessage, "watchdog timeout");
  } finally {
    (prisma.jobRun.updateMany as unknown) = original;
  }
});
