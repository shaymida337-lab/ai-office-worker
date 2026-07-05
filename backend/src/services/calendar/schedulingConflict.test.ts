import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  checkUnifiedSchedulingConflict,
  checkUnifiedSchedulingConflictByDuration,
} from "./schedulingConflict.js";
import {
  organizationSchedulingLockKey,
  withOrganizationSchedulingLock,
} from "./schedulingLock.js";

const ORG_A = "org-scheduling-a";
const ORG_B = "org-scheduling-b";

function at(iso: string) {
  return new Date(iso);
}

function mockCombinedBusyBlocks(options: {
  appointments?: Array<{
    id: string;
    startTime: Date;
    durationMinutes: number;
    client?: { name: string };
    service?: { name: string } | null;
  }>;
  calendarEvents?: Array<{
    id: string;
    startAt: Date;
    endAt: Date;
    client?: { name: string };
    service?: { name: string } | null;
  }>;
}) {
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  prisma.appointment.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string } | undefined;
    if (where?.organizationId === ORG_B) return [];
    return options.appointments ?? [];
  }) as typeof prisma.appointment.findMany;

  prisma.calendarEvent.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string } | undefined;
    if (where?.organizationId === ORG_B) return [];
    return options.calendarEvents ?? [];
  }) as typeof prisma.calendarEvent.findMany;

  return () => {
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  };
}

test("appointment vs appointment overlap is detected", async () => {
  const restore = mockCombinedBusyBlocks({
    appointments: [
      {
        id: "appt-1",
        startTime: at("2026-06-20T10:00:00.000Z"),
        durationMinutes: 60,
        client: { name: "Alice" },
      },
    ],
  });
  try {
    const result = await checkUnifiedSchedulingConflictByDuration({
      organizationId: ORG_A,
      startTime: at("2026-06-20T10:30:00.000Z"),
      durationMinutes: 60,
    });
    assert.equal(result.hasConflict, true);
    assert.equal(result.conflict?.source, "appointment");
    assert.equal(result.conflict?.id, "appt-1");
  } finally {
    restore();
  }
});

test("appointment vs calendar event overlap is detected", async () => {
  const restore = mockCombinedBusyBlocks({
    calendarEvents: [
      {
        id: "evt-1",
        startAt: at("2026-06-20T14:00:00.000Z"),
        endAt: at("2026-06-20T15:00:00.000Z"),
        client: { name: "Engine Client" },
      },
    ],
  });
  try {
    const result = await checkUnifiedSchedulingConflictByDuration({
      organizationId: ORG_A,
      startTime: at("2026-06-20T14:30:00.000Z"),
      durationMinutes: 30,
    });
    assert.equal(result.hasConflict, true);
    assert.equal(result.conflict?.source, "calendar_event");
    assert.equal(result.conflict?.id, "evt-1");
  } finally {
    restore();
  }
});

test("calendar event vs calendar event overlap is detected", async () => {
  const restore = mockCombinedBusyBlocks({
    calendarEvents: [
      {
        id: "evt-a",
        startAt: at("2026-06-21T09:00:00.000Z"),
        endAt: at("2026-06-21T10:00:00.000Z"),
        client: { name: "First" },
      },
    ],
  });
  try {
    const result = await checkUnifiedSchedulingConflict({
      organizationId: ORG_A,
      start: at("2026-06-21T09:30:00.000Z"),
      end: at("2026-06-21T10:30:00.000Z"),
      excludeCalendarEventId: "evt-b",
    });
    assert.equal(result.hasConflict, true);
    assert.equal(result.conflict?.id, "evt-a");
  } finally {
    restore();
  }
});

test("excludeAppointmentId allows rescheduling the same appointment", async () => {
  const restore = mockCombinedBusyBlocks({
    appointments: [
      {
        id: "appt-reschedule",
        startTime: at("2026-06-22T11:00:00.000Z"),
        durationMinutes: 60,
        client: { name: "Bob" },
      },
    ],
  });
  try {
    const result = await checkUnifiedSchedulingConflictByDuration({
      organizationId: ORG_A,
      startTime: at("2026-06-22T12:00:00.000Z"),
      durationMinutes: 60,
      excludeAppointmentId: "appt-reschedule",
    });
    assert.equal(result.hasConflict, false);
  } finally {
    restore();
  }
});

test("different organizations do not share conflict state", async () => {
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  const orgQueries: string[] = [];

  prisma.appointment.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string } | undefined;
    if (where?.organizationId) orgQueries.push(where.organizationId);
    return [];
  }) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string } | undefined;
    if (where?.organizationId) orgQueries.push(where.organizationId);
    return [];
  }) as typeof prisma.calendarEvent.findMany;

  try {
    const result = await checkUnifiedSchedulingConflictByDuration({
      organizationId: ORG_B,
      startTime: at("2026-06-20T10:00:00.000Z"),
      durationMinutes: 60,
    });
    assert.equal(result.hasConflict, false);
    assert.ok(orgQueries.every((orgId) => orgId === ORG_B));
  } finally {
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  }
});

test("cancelled appointments are excluded at query level", async () => {
  const original = prisma.appointment.findMany.bind(prisma.appointment);
  let capturedWhere: unknown;
  prisma.appointment.findMany = (async (args) => {
    capturedWhere = args?.where;
    return [];
  }) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;

  try {
    await checkUnifiedSchedulingConflictByDuration({
      organizationId: ORG_A,
      startTime: at("2026-06-20T10:00:00.000Z"),
      durationMinutes: 60,
    });
    assert.deepEqual((capturedWhere as { status: { not: string } }).status, { not: "cancelled" });
  } finally {
    prisma.appointment.findMany = original;
  }
});

test("parallel booking race: second slot check sees first appointment in combined blocks", async () => {
  const restore = mockCombinedBusyBlocks({
    appointments: [
      {
        id: "first-booking",
        startTime: at("2026-06-23T08:00:00.000Z"),
        durationMinutes: 60,
        client: { name: "First" },
      },
    ],
  });
  try {
    const concurrentCheck = await checkUnifiedSchedulingConflictByDuration({
      organizationId: ORG_A,
      startTime: at("2026-06-23T08:30:00.000Z"),
      durationMinutes: 60,
    });
    assert.equal(concurrentCheck.hasConflict, true);
    assert.equal(concurrentCheck.conflict?.id, "first-booking");
  } finally {
    restore();
  }
});

test("withOrganizationSchedulingLock acquires unified org scheduling advisory lock", async () => {
  const originalTransaction = prisma.$transaction.bind(prisma);
  let lockKey: string | null = null;

  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => {
    const tx = {
      $executeRaw: async (_parts: TemplateStringsArray, value: string) => {
        lockKey = value;
        return 1;
      },
    };
    return fn(tx as typeof prisma);
  }) as typeof prisma.$transaction;

  try {
    const result = await withOrganizationSchedulingLock(ORG_A, async () => "locked");
    assert.equal(result, "locked");
    assert.equal(lockKey, organizationSchedulingLockKey(ORG_A));
    assert.match(lockKey!, /^calendar-scheduling:/);
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test("organizationSchedulingLockKey is stable for appointment and engine paths", () => {
  const key = organizationSchedulingLockKey("org-123");
  assert.equal(key, "calendar-scheduling:org-123");
});
