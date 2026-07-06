import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { CalendarEngine } from "./calendarEngineFacade.js";
import { detectConflicts } from "./calendarEngineConflict.js";
import { validateEvent } from "./calendarEngineValidation.js";
import {
  getCalendarEngineHealthSnapshot,
  recordCalendarEngineHealthFailure,
  recordCalendarEngineHealthSuccess,
  resetCalendarEngineHealthForTests,
} from "./calendarEngineHealth.js";
import {
  disableCalendarEngineMemoryIdempotencyForTests,
  resetCalendarEngineIdempotencyForTests,
  runCalendarEngineIdempotent,
} from "./calendarEngineIdempotency.js";
import { classifyCalendarEngineError, runCalendarEngineOperation } from "./calendarEngineReliability.js";
import {
  getCalendarGoogleSyncPort,
  NoOpCalendarGoogleSyncPort,
  resetCalendarGoogleSyncPortForTests,
} from "./calendarGoogleSyncPort.js";
import { CalendarEngineServiceError } from "./serviceErrors.js";

const ORG = "org-engine-b";
const USER = "user-1";
const CLIENT = "client-1";

function futureDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date;
}

function installValidationMocks(options?: { busyEvent?: { id: string; startAt: Date; endAt: Date } }) {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    organizationFindFirst: prisma.organization.findFirst.bind(prisma.organization),
    userFindFirst: prisma.user.findFirst.bind(prisma.user),
    clientFindFirst: prisma.client.findFirst.bind(prisma.client),
    calendarEventFindFirst: prisma.calendarEvent.findFirst.bind(prisma.calendarEvent),
    appointmentFindFirst: prisma.appointment.findFirst.bind(prisma.appointment),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
  };

  prisma.organization.findUnique = (async () => ({ timezone: "Asia/Jerusalem" })) as typeof prisma.organization.findUnique;
  prisma.organization.findFirst = (async () => ({ timezone: "Asia/Jerusalem" })) as typeof prisma.organization.findFirst;
  prisma.user.findFirst = (async (args) => {
    const id = args?.where?.id as string | undefined;
    return id === USER ? { id: USER } : null;
  }) as typeof prisma.user.findFirst;
  prisma.client.findFirst = (async (args) => {
    const id = args?.where?.id as string | undefined;
    return id === CLIENT ? { id: CLIENT } : null;
  }) as typeof prisma.client.findFirst;
  prisma.calendarEvent.findFirst = (async () => null) as typeof prisma.calendarEvent.findFirst;
  prisma.appointment.findFirst = (async () => null) as typeof prisma.appointment.findFirst;
  prisma.calendarEvent.findMany = (async () => {
    if (!options?.busyEvent) return [];
    return [
      {
        id: options.busyEvent.id,
        startAt: options.busyEvent.startAt,
        endAt: options.busyEvent.endAt,
        client: { name: "Busy Client" },
        service: { name: "Service" },
      },
    ];
  }) as typeof prisma.calendarEvent.findMany;
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;

  return () => {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.organization.findFirst = originals.organizationFindFirst;
    prisma.user.findFirst = originals.userFindFirst;
    prisma.client.findFirst = originals.clientFindFirst;
    prisma.calendarEvent.findFirst = originals.calendarEventFindFirst;
    prisma.appointment.findFirst = originals.appointmentFindFirst;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.appointment.findMany = originals.appointmentFindMany;
  };
}

test("validateEvent rejects invalid time range", async () => {
  const restore = installValidationMocks();
  try {
    const start = futureDate();
    const end = new Date(start.getTime() - 60_000);
    const result = await validateEvent({
      organizationId: ORG,
      input: { startAt: start, endAt: end, source: "manual" },
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.code === "INVALID_TIME_RANGE"));
  } finally {
    restore();
  }
});

test("validateEvent rejects invalid attendee", async () => {
  const restore = installValidationMocks();
  try {
    const start = futureDate();
    const end = new Date(start.getTime() + 30 * 60_000);
    const result = await validateEvent({
      organizationId: ORG,
      input: {
        startAt: start,
        endAt: end,
        source: "manual",
        assignedUserId: "missing-user",
      },
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.code === "INVALID_ATTENDEE"));
  } finally {
    restore();
  }
});

test("detectConflicts returns suggestions when overlap exists", async () => {
  const start = futureDate();
  const end = new Date(start.getTime() + 30 * 60_000);
  const restore = installValidationMocks({
    busyEvent: { id: "evt-busy", startAt: start, endAt: end },
  });

  try {
    const result = await detectConflicts({
      organizationId: ORG,
      input: { startAt: start, endAt: end },
    });
    assert.equal(result.hasConflict, true);
    assert.equal(result.conflicts[0]?.type, "overlapping_meeting");
    assert.ok(Array.isArray(result.suggestedSlots));
  } finally {
    restore();
  }
});

test("health metrics track success and failure", () => {
  resetCalendarEngineHealthForTests();
  recordCalendarEngineHealthSuccess({ operation: "create", durationMs: 120 });
  recordCalendarEngineHealthFailure({ operation: "create", durationMs: 80, classification: "conflict" });

  const snapshot = getCalendarEngineHealthSnapshot();
  assert.equal(snapshot.totalOperations, 2);
  assert.equal(snapshot.successfulOperations, 1);
  assert.equal(snapshot.failedOperations, 1);
  assert.equal(snapshot.conflictCount, 1);
  assert.equal(snapshot.operationCounts.create, 2);
  assert.equal(snapshot.averageLatencyMs, 100);
});

test("idempotency replays same key without double execution", async () => {
  resetCalendarEngineIdempotencyForTests();
  let executions = 0;
  const first = await runCalendarEngineIdempotent({
    organizationId: ORG,
    operation: "create",
    idempotencyKey: "key-1",
    payload: { startAt: "2026-07-10T10:00:00.000Z" },
    execute: async () => {
      executions += 1;
      return { id: "evt-1" };
    },
  });
  const second = await runCalendarEngineIdempotent({
    organizationId: ORG,
    operation: "create",
    idempotencyKey: "key-1",
    payload: { startAt: "2026-07-10T10:00:00.000Z" },
    execute: async () => {
      executions += 1;
      return { id: "evt-1" };
    },
  });

  assert.equal(first.replay, false);
  assert.equal(second.replay, true);
  assert.equal(executions, 1);
  disableCalendarEngineMemoryIdempotencyForTests();
});

test("reliability wrapper classifies validation errors", () => {
  const classification = classifyCalendarEngineError(
    new CalendarEngineServiceError("VALIDATION_FAILED", "bad input")
  );
  assert.equal(classification, "validation");
});

test("reliability wrapper retries transient failures", async () => {
  resetCalendarEngineHealthForTests();
  let attempts = 0;
  const { result, correlationId } = await runCalendarEngineOperation({
    operation: "validate",
    ctx: { organizationId: ORG, source: "api", actor: { actorType: "system" }, timeoutMs: 5_000 },
    execute: async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("ECONNRESET");
      return { ok: true };
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.ok(correlationId.startsWith("cal-"));
  assert.equal(attempts, 2);
});

test("reliability wrapper surfaces timeout failures", async () => {
  resetCalendarEngineHealthForTests();
  await assert.rejects(
    () =>
      runCalendarEngineOperation({
        operation: "validate",
        ctx: { organizationId: ORG, source: "api", actor: { actorType: "system" }, timeoutMs: 5 },
        execute: async () => new Promise((resolve) => setTimeout(resolve, 50)),
      }),
    /CALENDAR_ENGINE_TIMEOUT/
  );
  const snapshot = getCalendarEngineHealthSnapshot();
  assert.equal(snapshot.failedOperations, 1);
});

test("google sync port defaults to no-op", async () => {
  resetCalendarGoogleSyncPortForTests();
  const port = getCalendarGoogleSyncPort();
  assert.ok(port instanceof NoOpCalendarGoogleSyncPort);
  const result = await port.scheduleSync({
    organizationId: ORG,
    calendarEventId: "evt-1",
    action: "create",
    actor: { actorType: "system" },
  });
  assert.equal(result.status, "skipped");
});

test("CalendarEngine.createEvent blocks on validation failure", async () => {
  const restore = installValidationMocks();
  try {
    const start = futureDate();
    const end = new Date(start.getTime() - 60_000);
    const result = await CalendarEngine.createEvent(
      { organizationId: ORG, source: "ui", actor: { actorType: "user", actorUserId: USER } },
      { startAt: start, endAt: end, source: "manual" }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "VALIDATION_FAILED");
      assert.equal(result.classification, "validation");
    }
  } finally {
    restore();
  }
});

test("CalendarEngine.createEvent blocks on conflict", async () => {
  const start = futureDate();
  const end = new Date(start.getTime() + 30 * 60_000);
  const restore = installValidationMocks({
    busyEvent: { id: "evt-busy", startAt: start, endAt: end },
  });

  try {
    const result = await CalendarEngine.createEvent(
      { organizationId: ORG, source: "ui", actor: { actorType: "user", actorUserId: USER } },
      { startAt: start, endAt: end, source: "manual" }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "TIME_CONFLICT");
      assert.equal(result.classification, "conflict");
      assert.ok(result.conflict);
    }
  } finally {
    restore();
  }
});
