import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";

const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;

type JobRunStatus = "running" | "completed" | "failed" | "timeout";

type StartJobRunInput = {
  organizationId?: string | null;
  jobType: string;
  referenceId?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  payloadJson?: Prisma.InputJsonValue;
};

function safeTimeoutAt(timeoutMs?: number) {
  const ms = Number.isFinite(timeoutMs) && (timeoutMs as number) > 0
    ? Number(timeoutMs)
    : DEFAULT_JOB_TIMEOUT_MS;
  return new Date(Date.now() + ms);
}

async function runBestEffort(label: string, op: () => Promise<void>) {
  try {
    await op();
  } catch (err) {
    console.warn(`[job-run] ${label} skipped`, err instanceof Error ? err.message : String(err));
  }
}

async function updateReferenceJobRun(
  jobType: string,
  referenceId: string,
  data: {
    status?: JobRunStatus;
    heartbeatAt?: Date;
    timeoutAt?: Date;
    completedAt?: Date | null;
    errorMessage?: string | null;
  }
) {
  await prisma.jobRun.updateMany({
    where: {
      jobType,
      referenceId,
      status: "running",
    },
    data,
  });
}

export async function startJobRun(input: StartJobRunInput) {
  await runBestEffort("start", async () => {
    const now = new Date();
    await prisma.jobRun.create({
      data: {
        organizationId: input.organizationId ?? null,
        jobType: input.jobType,
        referenceId: input.referenceId ?? null,
        status: "running",
        startedAt: now,
        heartbeatAt: now,
        timeoutAt: safeTimeoutAt(input.timeoutMs),
        maxRetries: input.maxRetries ?? 0,
        payloadJson: input.payloadJson ?? undefined,
      },
    });
  });
}

export async function heartbeatJobRun(input: {
  jobType: string;
  referenceId?: string | null;
  timeoutMs?: number;
}) {
  const referenceId = input.referenceId;
  if (!referenceId) return;
  await runBestEffort("heartbeat", async () => {
    await updateReferenceJobRun(input.jobType, referenceId, {
      heartbeatAt: new Date(),
      timeoutAt: safeTimeoutAt(input.timeoutMs),
      errorMessage: null,
    });
  });
}

export async function completeJobRun(input: {
  jobType: string;
  referenceId?: string | null;
}) {
  const referenceId = input.referenceId;
  if (!referenceId) return;
  await runBestEffort("complete", async () => {
    await updateReferenceJobRun(input.jobType, referenceId, {
      status: "completed",
      completedAt: new Date(),
      heartbeatAt: new Date(),
      errorMessage: null,
    });
  });
}

export async function failJobRun(input: {
  jobType: string;
  referenceId?: string | null;
  errorMessage?: string | null;
}) {
  const referenceId = input.referenceId;
  if (!referenceId) return;
  await runBestEffort("fail", async () => {
    await updateReferenceJobRun(input.jobType, referenceId, {
      status: "failed",
      completedAt: new Date(),
      heartbeatAt: new Date(),
      errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
    });
  });
}

export async function timeoutStaleJobRuns(now = new Date()) {
  let timedOut = 0;
  await runBestEffort("timeout_stale", async () => {
    const result = await prisma.jobRun.updateMany({
      where: {
        status: "running",
        timeoutAt: { lt: now },
      },
      data: {
        status: "timeout",
        completedAt: now,
        heartbeatAt: now,
        errorMessage: "watchdog timeout",
      },
    });
    timedOut = result.count;
    if (result.count > 0) {
      console.warn(`[job-run-watchdog] marked ${result.count} stale jobs as timeout`);
    }
  });
  return timedOut;
}
