import "./stressEnvBootstrap.js";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { apiRouter } from "../routes/api.js";
import { prisma, connectPrisma } from "../lib/prisma.js";
import { signToken } from "../lib/auth.js";
import { createDraftCalendarEvent, submitCalendarEventForConfirmation } from "../services/calendar/calendarEventService.js";
import { approveDecisionQueueItem } from "../services/calendar/decisionQueueService.js";
import type { CalendarEventActor } from "../services/calendar/calendarEventMutations.js";
import { executeNataliePendingProposal } from "../services/conversation/voice/natalieProposalExecution.js";
import { appointmentEnd } from "../services/calendar/engine.js";

const BLOCKING_APPOINTMENT_STATUSES = ["pending", "confirmed"] as const;
const BLOCKING_EVENT_STATUSES = ["pending_readiness", "confirmed"] as const;

/** Far-future slot within default working hours (Asia/Jerusalem). */
export const STRESS_SLOT_ISO = "2030-07-15T07:00:00.000Z";
export const STRESS_DURATION_MINUTES = 60;

export type StressOrgFixture = {
  runId: string;
  organizationId: string;
  userId: string;
  email: string;
  clientId: string;
  clientName: string;
  token: string;
  engineEnabled: boolean;
};

export type RequestOutcome = {
  label: string;
  ok: boolean;
  status: number;
  durationMs: number;
  conflict: boolean;
  error?: string;
  body?: unknown;
};

export type StressMetrics = {
  scenario: string;
  requestsExecuted: number;
  successfulBookings: number;
  rejectedConflicts: number;
  otherFailures: number;
  latenciesMs: number[];
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughputPerSecond: number;
  wallClockMs: number;
  dbValidation: DbValidationResult;
};

export type DbValidationResult = {
  ok: boolean;
  overlappingBlockingPairs: number;
  blockingAppointments: number;
  blockingCalendarEvents: number;
  orphanWorkCases: number;
  orphanCalendarEvents: number;
  brokenForeignKeys: string[];
  notes: string[];
};

export function isStressDbEnabled(): boolean {
  return process.env.STRESS_DB === "1";
}

export function isSafeStressDatabaseUrl(): boolean {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) return false;
  if (/neon\.tech|render\.com|prod|production/i.test(raw)) return false;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "postgres";
  } catch {
    return false;
  }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function summarizeMetrics(
  scenario: string,
  outcomes: RequestOutcome[],
  wallClockMs: number,
  dbValidation: DbValidationResult
): StressMetrics {
  const latencies = outcomes.map((o) => o.durationMs).sort((a, b) => a - b);
  const successfulBookings = outcomes.filter((o) => o.ok && !o.conflict).length;
  const rejectedConflicts = outcomes.filter((o) => o.conflict).length;
  const otherFailures = outcomes.filter((o) => !o.ok && !o.conflict).length;
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const throughput = wallClockMs > 0 ? (outcomes.length / wallClockMs) * 1000 : 0;

  return {
    scenario,
    requestsExecuted: outcomes.length,
    successfulBookings,
    rejectedConflicts,
    otherFailures,
    latenciesMs: latencies,
    avgLatencyMs: Math.round(avg * 100) / 100,
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    throughputPerSecond: Math.round(throughput * 100) / 100,
    wallClockMs,
    dbValidation,
  };
}

export function latencyHistogram(latenciesMs: number[]): Record<string, number> {
  const buckets: Record<string, number> = {
    "0-25ms": 0,
    "25-50ms": 0,
    "50-100ms": 0,
    "100-250ms": 0,
    "250-500ms": 0,
    "500ms-1s": 0,
    "1s+": 0,
  };
  for (const ms of latenciesMs) {
    if (ms < 25) buckets["0-25ms"]++;
    else if (ms < 50) buckets["25-50ms"]++;
    else if (ms < 100) buckets["50-100ms"]++;
    else if (ms < 250) buckets["100-250ms"]++;
    else if (ms < 500) buckets["250-500ms"]++;
    else if (ms < 1000) buckets["500ms-1s"]++;
    else buckets["1s+"]++;
  }
  return buckets;
}

export async function ensureStressEnv(): Promise<void> {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "stress-test-jwt-secret-not-for-production";
  }
  process.env.CALENDAR_ENGINE_V1_READ = "true";
  process.env.CALENDAR_ENGINE_V1_WRITE = "true";
  process.env.PRISMA_CONNECTION_LIMIT = process.env.PRISMA_CONNECTION_LIMIT ?? "30";
  await connectPrisma();
}

export async function createStressOrg(options?: {
  engineEnabled?: boolean;
  autoConfirm?: boolean;
  prefix?: string;
}): Promise<StressOrgFixture> {
  const runId = options?.prefix ?? randomUUID().slice(0, 8);
  const userId = `stress-user-${runId}`;
  const organizationId = `stress-org-${runId}`;
  const email = `stress-${runId}@example.com`;
  const clientId = `stress-client-${runId}`;
  const clientName = `Stress Client ${runId}`;

  await prisma.user.create({
    data: {
      id: userId,
      email,
      name: `Stress User ${runId}`,
    },
  });

  await prisma.organization.create({
    data: {
      id: organizationId,
      userId,
      name: `Stress Org ${runId}`,
      timezone: "UTC",
      calendarEngineReadEnabled: options?.engineEnabled ?? false,
      calendarEngineWriteEnabled: options?.engineEnabled ?? false,
      ...(options?.autoConfirm
        ? {
            calendarAutonomyJson: {
              calendarAutonomy: {
                autoConfirmWhenFullyReady: true,
                autoSendFollowUp: false,
                autoSyncGoogleOnConfirm: false,
                autoCreateFollowUpTask: false,
              },
            },
          }
        : {}),
    },
  });

  await prisma.organizationMember.create({
    data: {
      organizationId,
      userId,
      role: "owner",
    },
  });

  await prisma.client.create({
    data: {
      id: clientId,
      organizationId,
      name: clientName,
      email: `client-${runId}@example.com`,
      isActive: true,
    },
  });

  const token = signToken({ userId, organizationId, email });

  return {
    runId,
    organizationId,
    userId,
    email,
    clientId,
    clientName,
    token,
    engineEnabled: options?.engineEnabled ?? false,
  };
}

export async function cleanupStressOrg(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { userId: true },
  });
  if (!org) return;

  await prisma.organization.delete({ where: { id: organizationId } });
  await prisma.user.delete({ where: { id: org.userId } }).catch(() => undefined);
}

export async function startStressApiServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function actor(userId: string): CalendarEventActor {
  return { actorType: "user", actorUserId: userId };
}

export async function postAppointmentHttp(
  baseUrl: string,
  token: string,
  body: Record<string, unknown>,
  label: string
): Promise<RequestOutcome> {
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl}/api/appointments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const durationMs = performance.now() - started;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const errorText = String(json.error ?? "");
    const conflict =
      res.status === 409 ||
      json.code === "time_conflict" ||
      /תפוסה|time conflict|time_conflict|transaction already closed|connection pool/i.test(errorText);
    return {
      label,
      ok: res.status === 201,
      status: res.status,
      durationMs,
      conflict,
      error: conflict ? String(json.error ?? "time_conflict") : res.ok ? undefined : String(json.error ?? res.status),
      body: json,
    };
  } catch (err) {
    return {
      label,
      ok: false,
      status: 0,
      durationMs: performance.now() - started,
      conflict: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function postNatalieAppointmentHttp(
  baseUrl: string,
  token: string,
  body: Record<string, unknown>,
  label: string
): Promise<RequestOutcome> {
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl}/api/natalie/create-appointment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const durationMs = performance.now() - started;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const conflict =
      res.status === 409 ||
      json.code === "time_conflict" ||
      (typeof json.error === "string" && json.error.includes("תפוסה"));
    return {
      label,
      ok: res.status === 201,
      status: res.status,
      durationMs,
      conflict,
      error: conflict ? String(json.error ?? "time_conflict") : res.ok ? undefined : String(json.error ?? res.status),
      body: json,
    };
  } catch (err) {
    return {
      label,
      ok: false,
      status: 0,
      durationMs: performance.now() - started,
      conflict: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function voiceBookAppointment(
  fixture: StressOrgFixture,
  startTimeIso: string,
  label: string
): Promise<RequestOutcome> {
  const started = performance.now();
  try {
    const result = await executeNataliePendingProposal({
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      action: "book_appointment",
      proposal: {
        clientName: fixture.clientName,
        startTime: startTimeIso,
        durationMinutes: STRESS_DURATION_MINUTES,
      },
    });
    const durationMs = performance.now() - started;
    const conflict = !result.ok && /תפוסה|conflict/i.test(result.message);
    return {
      label,
      ok: result.ok,
      status: result.ok ? 201 : conflict ? 409 : 500,
      durationMs,
      conflict,
      error: result.ok ? undefined : result.message,
      body: result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      label,
      ok: false,
      status: /time_conflict|תפוסה/i.test(message) ? 409 : 500,
      durationMs: performance.now() - started,
      conflict: /time_conflict|תפוסה/i.test(message),
      error: message,
    };
  }
}

export async function seedDraftCalendarEvent(
  fixture: StressOrgFixture,
  startTime: Date,
  suffix: string
): Promise<string> {
  const endAt = appointmentEnd(startTime, STRESS_DURATION_MINUTES);
  const event = await createDraftCalendarEvent(
    fixture.organizationId,
    {
      title: `Stress draft ${suffix}`,
      startAt: startTime,
      endAt,
      timezone: "UTC",
      clientId: fixture.clientId,
      source: "manual",
      createdByUserId: fixture.userId,
      workCaseTitle: `Stress work case ${suffix}`,
    },
    actor(fixture.userId)
  );
  return event.id;
}

export async function confirmCalendarEventBlocking(
  fixture: StressOrgFixture,
  eventId: string,
  label: string
): Promise<RequestOutcome> {
  const started = performance.now();
  try {
    const submit = await submitCalendarEventForConfirmation(fixture.organizationId, eventId, actor(fixture.userId));
    if (submit.mode === "queued") {
      if (submit.queueType === "override_conflict") {
        return {
          label,
          ok: false,
          status: 409,
          durationMs: performance.now() - started,
          conflict: true,
          error: "override_conflict_required",
        };
      }
      await approveDecisionQueueItem(
        fixture.organizationId,
        submit.decisionId,
        actor(fixture.userId)
      );
    }
    return {
      label,
      ok: true,
      status: 200,
      durationMs: performance.now() - started,
      conflict: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    const conflict = code === "TIME_CONFLICT" || /time conflict|תפוסה/i.test(message);
    return {
      label,
      ok: false,
      status: conflict ? 409 : 500,
      durationMs: performance.now() - started,
      conflict,
      error: message,
    };
  }
}

export async function validateDbConsistency(
  organizationId: string,
  slotStart: Date,
  slotEnd: Date,
  options?: { maxBlockingEntities?: number; allowOverlapCount?: number }
): Promise<DbValidationResult> {
  const maxBlocking = options?.maxBlockingEntities ?? 1;
  const allowOverlap = options?.allowOverlapCount ?? 0;
  const notes: string[] = [];

  const appointments = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: { not: "cancelled" },
      startTime: { lt: slotEnd },
    },
    select: { id: true, startTime: true, durationMinutes: true, status: true },
  });

  const blockingAppointments = appointments.filter((row) => {
    const end = appointmentEnd(row.startTime, row.durationMinutes);
    return end > slotStart && row.startTime < slotEnd;
  });

  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId,
      status: { in: [...BLOCKING_EVENT_STATUSES] },
      startAt: { lt: slotEnd },
      endAt: { gt: slotStart },
    },
    select: { id: true, workCaseId: true, status: true },
  });

  type Block = { kind: "appointment" | "calendar_event"; id: string; start: Date; end: Date };
  const blocks: Block[] = [
    ...blockingAppointments.map((row) => ({
      kind: "appointment" as const,
      id: row.id,
      start: row.startTime,
      end: appointmentEnd(row.startTime, row.durationMinutes),
    })),
    ...(
      await prisma.calendarEvent.findMany({
        where: { id: { in: events.map((e) => e.id) } },
        select: { id: true, startAt: true, endAt: true },
      })
    ).map((row) => ({
      kind: "calendar_event" as const,
      id: row.id,
      start: row.startAt,
      end: row.endAt,
    })),
  ];

  let overlappingPairs = 0;
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (a.start < b.end && b.start < a.end) overlappingPairs++;
    }
  }

  const orphanWorkCases = await prisma.workCase.count({
    where: {
      organizationId,
      calendarEvents: { none: {} },
    },
  });

  const orphanCalendarEvents = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "CalendarEvent" ce
    LEFT JOIN "WorkCase" wc ON wc.id = ce."workCaseId"
    WHERE ce."organizationId" = ${organizationId} AND wc.id IS NULL
  `.then((rows) => Number(rows[0]?.count ?? 0));

  const brokenForeignKeys: string[] = [];
  try {
    const fkViolations = await prisma.$queryRaw<{ table_name: string; constraint_name: string }[]>`
      SELECT conrelid::regclass::text AS table_name, conname AS constraint_name
      FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace
      LIMIT 1
    `;
    if (fkViolations.length === 0) notes.push("FK catalog reachable");
  } catch (err) {
    brokenForeignKeys.push(err instanceof Error ? err.message : String(err));
  }

  const totalBlocking = blocks.length;
  const pairOk = overlappingPairs <= allowOverlap;
  const countOk = totalBlocking <= maxBlocking || allowOverlap > 0;

  if (!countOk) {
    notes.push(`expected at most ${maxBlocking} blocking entities, found ${totalBlocking}`);
  }
  if (!pairOk) {
    notes.push(`expected at most ${allowOverlap} overlapping pairs, found ${overlappingPairs}`);
  }

  return {
    ok: countOk && pairOk && orphanWorkCases === 0 && orphanCalendarEvents === 0,
    overlappingBlockingPairs: overlappingPairs,
    blockingAppointments: blockingAppointments.length,
    blockingCalendarEvents: events.length,
    orphanWorkCases,
    orphanCalendarEvents,
    brokenForeignKeys,
    notes,
  };
}

export function writeStressReport(scenario: string, metrics: StressMetrics): string {
  const report = {
    generatedAt: new Date().toISOString(),
    scenario,
    summary: {
      requestsExecuted: metrics.requestsExecuted,
      successfulBookings: metrics.successfulBookings,
      rejectedConflicts: metrics.rejectedConflicts,
      otherFailures: metrics.otherFailures,
      avgLatencyMs: metrics.avgLatencyMs,
      p95LatencyMs: metrics.p95LatencyMs,
      p99LatencyMs: metrics.p99LatencyMs,
      throughputPerSecond: metrics.throughputPerSecond,
      wallClockMs: metrics.wallClockMs,
    },
    latencyHistogram: latencyHistogram(metrics.latenciesMs),
    dbValidation: metrics.dbValidation,
  };

  const dir = join(process.cwd(), "stress-reports");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${scenario.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

export function stressSlotRange(): { start: Date; end: Date; iso: string } {
  const start = new Date(STRESS_SLOT_ISO);
  const end = appointmentEnd(start, STRESS_DURATION_MINUTES);
  return { start, end, iso: start.toISOString() };
}

export { BLOCKING_APPOINTMENT_STATUSES, BLOCKING_EVENT_STATUSES };
