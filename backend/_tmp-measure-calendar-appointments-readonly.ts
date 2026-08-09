/**
 * READ-ONLY measure only — do not mutate production data.
 * Allowed DB ops: findMany / findFirst / count / aggregate / EXPLAIN (timing).
 * Forbidden: create/update/delete/upsert/executeRawUnsafe/DDL/DML writes/migrations.
 *
 * Output is metrics-only (ids hashed or omitted). No names, phones, emails, notes, or PII.
 */
import { config as loadEnv } from "dotenv";
import { createHash } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(prodUrl);
if (!prodUrl) {
  console.error("PROD_DATABASE_URL / DATABASE_URL missing");
  process.exit(1);
}
if (!isLocal && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error("Remote DB blocked. Set ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}
process.env.DATABASE_URL = prodUrl;

const ORG_NAME = process.env.VERIFY_ORG_NAME ?? "שי";
const probe = new PrismaClient({ datasources: { db: { url: prodUrl } } });

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

/** Legacy 3-round-trip path — READ ONLY (findMany ×3 waves). */
async function legacyThreeQuery(
  organizationId: string,
  from: Date,
  to: Date
): Promise<{ rows: number; ms: number; prismaCalls: number; dbQueryMs: number }> {
  const { APPOINTMENT_INCLUDE } = await import("./src/services/appointmentService.js");
  const t0 = performance.now();
  let prismaCalls = 0;
  const dbT0 = performance.now();
  prismaCalls += 1;
  const appointments = await probe.appointment.findMany({
    where: { organizationId, startTime: { gte: from, lt: to } },
    include: APPOINTMENT_INCLUDE,
    orderBy: { startTime: "asc" },
    take: 500,
  });
  const ids = appointments.map((a) => a.id);
  prismaCalls += 2;
  await Promise.all([
    probe.appointmentAttendanceProjection.findMany({
      where: { appointmentId: { in: ids } },
      select: {
        appointmentId: true,
        attendanceState: true,
        reminderState: true,
        confirmationStatus: true,
        lastReminderSentAt: true,
        lastResponseAt: true,
      },
    }),
    probe.appointmentReminderJob.findMany({
      where: {
        appointmentId: { in: ids },
        status: { in: ["pending", "failed", "leased"] },
      },
      orderBy: { scheduledForUtc: "asc" },
      select: { appointmentId: true, scheduledForUtc: true },
    }),
  ]);
  const dbQueryMs = Math.round(performance.now() - dbT0);
  return {
    rows: appointments.length,
    ms: Math.round(performance.now() - t0),
    prismaCalls,
    dbQueryMs,
  };
}

async function main() {
  const { listCalendarAppointmentsRange } = await import("./src/services/calendarAppointmentsList.js");

  // READ: findFirst — org id only (name used for lookup filter; never printed).
  const org = await probe.organization.findFirst({
    where: {
      OR: [{ name: { equals: ORG_NAME } }, { businessName: { contains: ORG_NAME } }, { name: { contains: ORG_NAME } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!org) throw new Error("org not found for VERIFY_ORG_NAME");

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // READ: count — bounded range row estimate (no row payload).
  const rangeCount = await probe.appointment.count({
    where: { organizationId: org.id, startTime: { gte: weekStart, lt: weekEnd } },
  });

  const timings: Array<{
    dbQueryMs: number;
    mapMs: number;
    serializeMs: number;
    totalMs: number;
    rowCount: number;
    prismaCallCount: number;
    organizationLookupCount: number;
  }> = [];

  // READ via service: single findMany (select). Timing only.
  const cold = await listCalendarAppointmentsRange(org.id, weekStart, weekEnd, {
    collectTiming: true,
    onTiming: (t) => timings.push(t),
  });
  const warm = await listCalendarAppointmentsRange(org.id, weekStart, weekEnd, {
    collectTiming: true,
    onTiming: (t) => timings.push(t),
  });
  void warm;

  const legacy = await legacyThreeQuery(org.id, weekStart, weekEnd);

  // Payload size from sanitized shape only (ids hashed; no PII fields).
  const sanitizedForBytes = cold.map((item) => ({
    idHash: hashId(item.id),
    organizationIdHash: hashId(item.organizationId),
    clientIdHash: item.clientId ? hashId(item.clientId) : null,
    serviceIdHash: item.serviceId ? hashId(item.serviceId) : null,
    employeeIdHash: item.employeeId ? hashId(item.employeeId) : null,
    startTime: item.startTime instanceof Date ? item.startTime.toISOString() : item.startTime,
    durationMinutes: item.durationMinutes,
    status: item.status,
    source: item.source,
    googleSyncStatus: item.googleSyncStatus,
    hasClient: Boolean(item.client),
    hasService: Boolean(item.service),
    hasEmployee: Boolean(item.employee),
    hasReminderStatus: Boolean(item.reminderStatus),
    reminderAttendanceState: item.reminderStatus?.attendanceState ?? null,
    reminderState: item.reminderStatus?.reminderState ?? null,
    confirmationStatus: item.reminderStatus?.confirmationStatus ?? null,
  }));
  const payloadBytesSanitized = Buffer.byteLength(JSON.stringify(sanitizedForBytes), "utf8");
  // Full response byte estimate without logging contents (stringify then discard).
  const payloadBytesFullResponse = Buffer.byteLength(JSON.stringify(cold), "utf8");

  const burst: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await listCalendarAppointmentsRange(org.id, weekStart, weekEnd);
    burst.push(Math.round(performance.now() - t0));
  }

  // Optional EXPLAIN (READ): index usage — parameterized $queryRaw only (no executeRawUnsafe).
  let explainPlan: string | null = null;
  try {
    const { Prisma } = await import("@prisma/client");
    const rows = await probe.$queryRaw<Array<{ "QUERY PLAN": string }>>`
      EXPLAIN (FORMAT TEXT)
      SELECT id FROM "Appointment"
      WHERE "organizationId" = ${org.id}
        AND "startTime" >= ${weekStart}
        AND "startTime" < ${weekEnd}
      ORDER BY "startTime" ASC
      LIMIT 500
    `;
    void Prisma;
    explainPlan = rows.map((r) => r["QUERY PLAN"]).join("\n");
  } catch {
    explainPlan = null;
  }

  console.log(
    JSON.stringify(
      {
        mode: "readonly",
        orgIdHash: hashId(org.id),
        range: { from: weekStart.toISOString(), to: weekEnd.toISOString() },
        rangeCount,
        rowCountNewPath: cold.length,
        coldTiming: timings[0] ?? null,
        warmTiming: timings[1] ?? null,
        legacyThreeQuery: {
          rows: legacy.rows,
          totalMs: legacy.ms,
          dbQueryMs: legacy.dbQueryMs,
          prismaCalls: legacy.prismaCalls,
        },
        payloadBytesSanitized,
        payloadBytesFullResponse,
        sequentialBurstMs: burst,
        prismaCallsBefore: 3,
        prismaCallsAfter: 1,
        parityRowCount: cold.length === legacy.rows,
        statusHistogram: cold.reduce<Record<string, number>>((acc, item) => {
          acc[item.status] = (acc[item.status] ?? 0) + 1;
          return acc;
        }, {}),
        sampleIdHashes: cold.slice(0, 5).map((i) => hashId(i.id)),
        indexHint: "Appointment @@index([organizationId, startTime])",
        explainPlan,
        note: "Local→prod RTT inflates absolute ms; compare before/after ratio and prismaCalls. No PII in this log.",
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await probe.$disconnect().catch(() => undefined);
  });
