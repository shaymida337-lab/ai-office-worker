import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import {
  CALENDAR_APPOINTMENT_LIST_TOP_LEVEL_KEYS,
  CALENDAR_APPOINTMENTS_RANGE_MAX,
  listCalendarAppointmentsRange,
  mapCalendarAppointmentListRow,
  type CalendarAppointmentListRow,
} from "./calendarAppointmentsList.js";

const ORG = "org-appt-list-a";
const ORG_OTHER = "org-appt-list-b";
const FROM = new Date("2026-07-12T00:00:00.000Z");
const TO = new Date("2026-07-19T00:00:00.000Z");

function row(partial: Partial<CalendarAppointmentListRow> & { id: string; organizationId: string }): CalendarAppointmentListRow {
  return {
    id: partial.id,
    organizationId: partial.organizationId,
    clientId: partial.clientId ?? "c1",
    serviceId: partial.serviceId ?? "s1",
    employeeId: partial.employeeId ?? null,
    startTime: partial.startTime ?? new Date("2026-07-15T10:00:00.000Z"),
    durationMinutes: partial.durationMinutes ?? 30,
    status: partial.status ?? "confirmed",
    notes: partial.notes ?? null,
    source: partial.source ?? "manual",
    googleEventId: partial.googleEventId ?? null,
    googleSyncStatus: partial.googleSyncStatus ?? "disabled",
    lastGoogleSyncError: partial.lastGoogleSyncError ?? null,
    lastGoogleSyncAt: partial.lastGoogleSyncAt ?? null,
    googleSyncAttemptCount: partial.googleSyncAttemptCount ?? 0,
    nextGoogleSyncRetryAt: partial.nextGoogleSyncRetryAt ?? null,
    createdAt: partial.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: partial.updatedAt ?? new Date("2026-07-01T00:00:00.000Z"),
    client: partial.client ?? {
      id: "c1",
      name: "Client",
      whatsappNumber: null,
      phone: null,
      email: null,
      emailIsPlaceholder: true,
      address: null,
      color: null,
    },
    service: partial.service !== undefined ? partial.service : { id: "s1", name: "Svc", color: "#111", durationMinutes: 30 },
    employee: partial.employee !== undefined ? partial.employee : null,
    attendanceProjection: partial.attendanceProjection !== undefined ? partial.attendanceProjection : null,
    reminderJobs: partial.reminderJobs !== undefined ? partial.reminderJobs : [],
  };
}

function installMocks(seed: CalendarAppointmentListRow[]) {
  const originals = {
    findMany: prisma.appointment.findMany.bind(prisma.appointment),
    projectionFindMany: prisma.appointmentAttendanceProjection.findMany.bind(
      prisma.appointmentAttendanceProjection
    ),
    jobFindMany: prisma.appointmentReminderJob.findMany.bind(prisma.appointmentReminderJob),
  };
  let findManyCalls = 0;
  let projectionCalls = 0;
  let jobCalls = 0;

  prisma.appointment.findMany = (async (args: {
    where?: {
      organizationId?: string;
      startTime?: { gte?: Date; lt?: Date };
      employeeId?: string | null;
    };
    take?: number;
  }) => {
    findManyCalls += 1;
    assert.ok(args?.take != null && args.take <= CALENDAR_APPOINTMENTS_RANGE_MAX);
    const org = args?.where?.organizationId;
    const gte = args?.where?.startTime?.gte;
    const lt = args?.where?.startTime?.lt;
    const employeeId = args?.where?.employeeId;
    return seed.filter((item) => {
      if (item.organizationId !== org) return false;
      if (gte && item.startTime < gte) return false;
      if (lt && !(item.startTime < lt)) return false;
      if (employeeId === null && item.employeeId !== null) return false;
      if (typeof employeeId === "string" && item.employeeId !== employeeId) return false;
      return true;
    });
  }) as typeof prisma.appointment.findMany;

  prisma.appointmentAttendanceProjection.findMany = (async () => {
    projectionCalls += 1;
    return [];
  }) as typeof prisma.appointmentAttendanceProjection.findMany;

  prisma.appointmentReminderJob.findMany = (async () => {
    jobCalls += 1;
    return [];
  }) as typeof prisma.appointmentReminderJob.findMany;

  return {
    findManyCalls: () => findManyCalls,
    projectionCalls: () => projectionCalls,
    jobCalls: () => jobCalls,
    restore() {
      prisma.appointment.findMany = originals.findMany;
      prisma.appointmentAttendanceProjection.findMany = originals.projectionFindMany;
      prisma.appointmentReminderJob.findMany = originals.jobFindMany;
    },
  };
}

test("org isolation for calendar appointments range", async () => {
  const mocks = installMocks([
    row({ id: "a1", organizationId: ORG, status: "confirmed" }),
    row({ id: "a2", organizationId: ORG_OTHER, status: "confirmed" }),
  ]);
  try {
    const items = await listCalendarAppointmentsRange(ORG, FROM, TO);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.id, "a1");
    assert.equal(mocks.findManyCalls(), 1);
    assert.equal(mocks.projectionCalls(), 0);
    assert.equal(mocks.jobCalls(), 0);
  } finally {
    mocks.restore();
  }
});

test("range boundaries: startTime gte from and lt to", async () => {
  const mocks = installMocks([
    row({ id: "before", organizationId: ORG, startTime: new Date("2026-07-11T23:59:59.000Z") }),
    row({ id: "in", organizationId: ORG, startTime: new Date("2026-07-12T00:00:00.000Z") }),
    row({ id: "edge", organizationId: ORG, startTime: new Date("2026-07-18T23:00:00.000Z") }),
    row({ id: "out", organizationId: ORG, startTime: new Date("2026-07-19T00:00:00.000Z") }),
  ]);
  try {
    const items = await listCalendarAppointmentsRange(ORG, FROM, TO);
    assert.deepEqual(
      items.map((i) => i.id).sort(),
      ["edge", "in"]
    );
  } finally {
    mocks.restore();
  }
});

test("cancelled/status parity preserved in payload", async () => {
  const mocks = installMocks([
    row({ id: "c1", organizationId: ORG, status: "cancelled" }),
    row({ id: "c2", organizationId: ORG, status: "pending" }),
  ]);
  try {
    const items = await listCalendarAppointmentsRange(ORG, FROM, TO);
    assert.equal(items.find((i) => i.id === "c1")!.status, "cancelled");
    assert.equal(items.find((i) => i.id === "c2")!.status, "pending");
  } finally {
    mocks.restore();
  }
});

test("employee filter owner vs specific", async () => {
  const mocks = installMocks([
    row({ id: "owner", organizationId: ORG, employeeId: null }),
    row({ id: "emp", organizationId: ORG, employeeId: "e1" }),
  ]);
  try {
    const ownerOnly = await listCalendarAppointmentsRange(ORG, FROM, TO, { employeeId: "owner" });
    assert.deepEqual(ownerOnly.map((i) => i.id), ["owner"]);
    const empOnly = await listCalendarAppointmentsRange(ORG, FROM, TO, { employeeId: "e1" });
    assert.deepEqual(empOnly.map((i) => i.id), ["emp"]);
  } finally {
    mocks.restore();
  }
});

test("field whitelist and missing relations are null-safe", () => {
  const mapped = mapCalendarAppointmentListRow(
    row({
      id: "sparse",
      organizationId: ORG,
      serviceId: null,
      employeeId: null,
      service: null,
      employee: null,
      attendanceProjection: null,
      reminderJobs: [],
      client: {
        id: "c-x",
        name: "Sparse",
        whatsappNumber: null,
        phone: null,
        email: null,
        emailIsPlaceholder: true,
        address: null,
        color: null,
      },
    })
  );
  assert.equal(mapped.service, null);
  assert.equal(mapped.employee, null);
  assert.equal(mapped.reminderStatus, null);
  assert.deepEqual(Object.keys(mapped).sort(), [...CALENDAR_APPOINTMENT_LIST_TOP_LEVEL_KEYS].sort());
  assert.equal("attendanceProjection" in mapped, false);
  assert.equal("reminderJobs" in mapped, false);
  assert.equal("reminderEvents" in mapped, false);
});

test("query count bounded: one prisma findMany, no separate projection/job calls", async () => {
  const mocks = installMocks([
    row({
      id: "with-rem",
      organizationId: ORG,
      attendanceProjection: {
        attendanceState: "scheduled",
        reminderState: "reminder_pending",
        confirmationStatus: "unknown",
        lastReminderSentAt: null,
        lastResponseAt: null,
      },
      reminderJobs: [{ scheduledForUtc: new Date("2026-07-14T09:00:00.000Z") }],
    }),
  ]);
  try {
    const timings: Array<{ prismaCallCount: number; rowCount: number }> = [];
    const items = await listCalendarAppointmentsRange(ORG, FROM, TO, {
      collectTiming: true,
      onTiming: (t) => timings.push(t),
    });
    assert.equal(items[0]!.reminderStatus?.nextReminderAt?.toISOString(), "2026-07-14T09:00:00.000Z");
    assert.equal(mocks.findManyCalls(), 1);
    assert.equal(mocks.projectionCalls(), 0);
    assert.equal(mocks.jobCalls(), 0);
    assert.equal(timings[0]!.prismaCallCount, 1);
  } finally {
    mocks.restore();
  }
});

test("rejects invalid range", async () => {
  await assert.rejects(
    () => listCalendarAppointmentsRange(ORG, TO, FROM),
    /from must be before to/
  );
});
