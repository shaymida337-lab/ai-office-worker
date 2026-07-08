import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import {
  GMAIL_SCAN_STUCK_TIMEOUT_MS,
  SCAN_STALE_TIMEOUT_REASON,
  closeOverdueActiveGmailScan,
  closeStaleGmailScansForOrg,
  createQueuedGmailScanLog,
  isGmailScanStuckWithoutProgress,
  refreshGmailScanProgressOnRead,
} from "./gmailScanLifecycle.js";

function baseActiveLog(overrides: Partial<{
  id: string;
  organizationId: string;
  status: string;
  scanMode: string | null;
  startedAt: Date;
  updatedAt: Date;
  emailsProcessed: number;
  emailsSaved: number;
  invoicesFound: number;
  paymentsCreated: number;
  tasksCreated: number;
  driveUploaded: number;
  sheetsUpdated: number;
  errorsCount: number;
  totalMatched: number | null;
  finishedAt: Date | null;
}> = {}) {
  const now = Date.now();
  const startedAt = new Date(now - GMAIL_SCAN_STUCK_TIMEOUT_MS - 5_000);
  return {
    id: "scan-active",
    organizationId: "org-1",
    type: "gmail_scan",
    status: "running",
    scanMode: "manual",
    startedAt,
    updatedAt: startedAt,
    emailsProcessed: 0,
    emailsSaved: 0,
    invoicesFound: 0,
    paymentsCreated: 0,
    tasksCreated: 0,
    driveUploaded: 0,
    sheetsUpdated: 0,
    errorsCount: 0,
    totalMatched: null,
    finishedAt: null,
    windowTruncated: false,
    errorMessage: null,
    ...overrides,
  };
}

test("closeOverdueActiveGmailScan marks stale running as timed_out and releases lock", async () => {
  const originalFind = prisma.syncLog.findFirst;
  const originalUpdate = prisma.syncLog.update;
  let terminalStatus: string | null = null;
  let errorMessage: string | null = null;
  let finishedAt: Date | null = null;
  const log = baseActiveLog();

  (prisma.syncLog.findFirst as unknown) = async () => ({
    status: log.status,
    finishedAt: null,
    startedAt: log.startedAt,
    organizationId: log.organizationId,
    scanMode: log.scanMode,
  });
  (prisma.syncLog.update as unknown) = async (args: { data: Record<string, unknown> }) => {
    terminalStatus = String(args.data.status);
    errorMessage = (args.data.errorMessage as string) ?? null;
    finishedAt = (args.data.finishedAt as Date) ?? null;
    return { id: log.id, ...args.data };
  };

  try {
    const closeAs = await closeOverdueActiveGmailScan(log, Date.now());
    assert.equal(closeAs, "timed_out");
    assert.equal(terminalStatus, "timed_out");
    assert.equal(errorMessage, SCAN_STALE_TIMEOUT_REASON);
    assert.ok(finishedAt instanceof Date);
  } finally {
    (prisma.syncLog.findFirst as unknown) = originalFind;
    (prisma.syncLog.update as unknown) = originalUpdate;
  }
});

test("closeOverdueActiveGmailScan marks stale queued as timed_out", async () => {
  const originalFind = prisma.syncLog.findFirst;
  const originalUpdate = prisma.syncLog.update;
  let terminalStatus: string | null = null;
  const log = baseActiveLog({ status: "queued", emailsProcessed: 0 });

  (prisma.syncLog.findFirst as unknown) = async () => ({
    status: "queued",
    finishedAt: null,
    startedAt: log.startedAt,
    organizationId: log.organizationId,
    scanMode: log.scanMode,
  });
  (prisma.syncLog.update as unknown) = async (args: { data: Record<string, unknown> }) => {
    terminalStatus = String(args.data.status);
    return { id: log.id, ...args.data };
  };

  try {
    assert.equal(await closeOverdueActiveGmailScan(log, Date.now()), "timed_out");
    assert.equal(terminalStatus, "timed_out");
  } finally {
    (prisma.syncLog.findFirst as unknown) = originalFind;
    (prisma.syncLog.update as unknown) = originalUpdate;
  }
});

test("fresh running scan is reused by createQueuedGmailScanLog (no duplicate)", async () => {
  const originalFindFirst = prisma.syncLog.findFirst;
  const originalCreate = prisma.syncLog.create;
  const now = Date.now();
  const fresh = baseActiveLog({
    id: "fresh-running",
    startedAt: new Date(now - 30_000),
    updatedAt: new Date(now - 5_000),
    emailsProcessed: 4,
  });
  let createCalled = false;

  (prisma.syncLog.findFirst as unknown) = async () => fresh;
  (prisma.syncLog.create as unknown) = async () => {
    createCalled = true;
    throw new Error("must not create duplicate while fresh scan running");
  };

  try {
    assert.equal(isGmailScanStuckWithoutProgress(fresh, now), false);
    const result = await createQueuedGmailScanLog("org-1", "manual");
    assert.equal(result.created, false);
    assert.equal(result.scanLog.id, "fresh-running");
    assert.equal(createCalled, false);
  } finally {
    (prisma.syncLog.findFirst as unknown) = originalFindFirst;
    (prisma.syncLog.create as unknown) = originalCreate;
  }
});

test("stale running scan is closed then new manual scan can start", async () => {
  const originalFindFirst = prisma.syncLog.findFirst;
  const originalFindMany = prisma.syncLog.findMany;
  const originalUpdate = prisma.syncLog.update;
  const originalCreate = prisma.syncLog.create;
  const stale = baseActiveLog({ id: "stale-running" });
  let createCalled = false;
  let closed = false;
  let activeLookupCount = 0;

  (prisma.syncLog.findFirst as unknown) = async (args: {
    where?: { id?: string; status?: { in?: string[] }; finishedAt?: unknown };
  }) => {
    // terminalizeGmailScan looks up by id
    if (args?.where?.id === "stale-running") {
      return closed
        ? {
            status: "timed_out",
            finishedAt: new Date(),
            startedAt: stale.startedAt,
            organizationId: "org-1",
            scanMode: "manual",
          }
        : {
            status: "running",
            finishedAt: null,
            startedAt: stale.startedAt,
            organizationId: "org-1",
            scanMode: "manual",
          };
    }
    // findActiveGmailScanLog
    activeLookupCount += 1;
    if (closed) return null;
    return stale;
  };
  (prisma.syncLog.update as unknown) = async (args: { data: Record<string, unknown> }) => {
    closed = true;
    assert.equal(args.data.status, "timed_out");
    return { id: stale.id, ...args.data };
  };
  (prisma.syncLog.create as unknown) = async (args: { data: Record<string, unknown> }) => {
    createCalled = true;
    const now = new Date();
    return {
      id: "new-scan",
      organizationId: "org-1",
      type: "gmail_scan",
      status: "queued",
      startedAt: now,
      updatedAt: now,
      ...args.data,
    };
  };
  (prisma.syncLog.findMany as unknown) = async () => [];

  try {
    assert.equal(isGmailScanStuckWithoutProgress(stale), true);
    const result = await createQueuedGmailScanLog("org-1", "manual");
    assert.equal(closed, true);
    assert.equal(createCalled, true);
    assert.equal(result.created, true);
    assert.equal(result.scanLog.id, "new-scan");
    assert.ok(activeLookupCount >= 1);
  } finally {
    (prisma.syncLog.findFirst as unknown) = originalFindFirst;
    (prisma.syncLog.findMany as unknown) = originalFindMany;
    (prisma.syncLog.update as unknown) = originalUpdate;
    (prisma.syncLog.create as unknown) = originalCreate;
  }
});

test("scan status / progress read auto-recovers stale scan", async () => {
  const originalFindFirst = prisma.syncLog.findFirst;
  const originalUpdate = prisma.syncLog.update;
  const stale = baseActiveLog({ id: "read-stale" });
  let closed = false;
  let reads = 0;

  (prisma.syncLog.findFirst as unknown) = async () => {
    reads += 1;
    if (!closed) return stale;
    return {
      ...stale,
      status: "timed_out",
      finishedAt: new Date(),
      errorMessage: SCAN_STALE_TIMEOUT_REASON,
    };
  };
  (prisma.syncLog.update as unknown) = async (args: { data: Record<string, unknown> }) => {
    closed = true;
    assert.equal(args.data.status, "timed_out");
    return { id: stale.id, ...args.data };
  };

  try {
    const recovered = await refreshGmailScanProgressOnRead("org-1", "read-stale");
    assert.equal(closed, true);
    assert.equal(recovered?.status, "timed_out");
    assert.equal(recovered?.errorMessage, SCAN_STALE_TIMEOUT_REASON);
    assert.ok(reads >= 2);
  } finally {
    (prisma.syncLog.findFirst as unknown) = originalFindFirst;
    (prisma.syncLog.update as unknown) = originalUpdate;
  }
});

test("closeStaleGmailScansForOrg releases stale lock before new work", async () => {
  const originalFindMany = prisma.syncLog.findMany;
  const originalFindFirst = prisma.syncLog.findFirst;
  const originalUpdate = prisma.syncLog.update;
  const stale = baseActiveLog({ id: "org-stale" });
  const closedIds: string[] = [];

  (prisma.syncLog.findMany as unknown) = async () => [stale];
  (prisma.syncLog.findFirst as unknown) = async () => ({
    status: "running",
    finishedAt: null,
    startedAt: stale.startedAt,
    organizationId: "org-1",
    scanMode: "manual",
  });
  (prisma.syncLog.update as unknown) = async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    closedIds.push(args.where.id);
    assert.equal(args.data.status, "timed_out");
    return { id: args.where.id, ...args.data };
  };

  try {
    assert.equal(isGmailScanStuckWithoutProgress(stale), true);
    const closed = await closeStaleGmailScansForOrg("org-1");
    assert.deepEqual(closed, ["org-stale"]);
    assert.deepEqual(closedIds, ["org-stale"]);
  } finally {
    (prisma.syncLog.findMany as unknown) = originalFindMany;
    (prisma.syncLog.findFirst as unknown) = originalFindFirst;
    (prisma.syncLog.update as unknown) = originalUpdate;
  }
});
