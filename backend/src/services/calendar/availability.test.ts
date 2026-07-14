import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { loadAppointmentBusyBlocks } from "./blocks.js";
import {
  checkSlotAvailability,
  findAvailableSlotsForOrganization,
  resolveDurationMinutes,
} from "./availability.js";
import { getCalendarRulesForOrganization } from "./rules.js";

const ORG = "org-calendar-test";
const SERVICE_ID = "service-60";

function at(iso: string) {
  return new Date(iso);
}

test("loadAppointmentBusyBlocks ignores cancelled appointments", async () => {
  const original = prisma.appointment.findMany.bind(prisma.appointment);
  let capturedWhere: unknown;
  prisma.appointment.findMany = (async (args: Parameters<typeof prisma.appointment.findMany>[0]) => {
    capturedWhere = args?.where;
    return [];
  }) as unknown as typeof prisma.appointment.findMany;
  try {
    const blocks = await loadAppointmentBusyBlocks(ORG, {
      start: at("2026-06-20T10:00:00.000Z"),
      end: at("2026-06-20T18:00:00.000Z"),
    });
    assert.equal(blocks.length, 0);
    assert.deepEqual((capturedWhere as { status: { not: string } }).status, { not: "cancelled" });
  } finally {
    prisma.appointment.findMany = original;
  }
});

test("loadAppointmentBusyBlocks uses overlap-aware filtering", async () => {
  const original = prisma.appointment.findMany.bind(prisma.appointment);
  prisma.appointment.findMany = (async () => [
    {
      id: "long",
      startTime: at("2026-06-18T09:00:00.000Z"),
      durationMinutes: 26 * 60,
      client: { name: "Client" },
      service: null,
    },
  ]) as unknown as typeof prisma.appointment.findMany;
  try {
    const blocks = await loadAppointmentBusyBlocks(ORG, {
      start: at("2026-06-19T10:00:00.000Z"),
      end: at("2026-06-19T11:00:00.000Z"),
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.id, "long");
  } finally {
    prisma.appointment.findMany = original;
  }
});

test("loadAppointmentBusyBlocks includes appointments starting more than 24h before range when they overlap", async () => {
  const original = prisma.appointment.findMany.bind(prisma.appointment);
  let capturedWhere: unknown;
  const range = {
    start: at("2026-06-20T10:00:00.000Z"),
    end: at("2026-06-20T11:00:00.000Z"),
  };
  prisma.appointment.findMany = (async (args: Parameters<typeof prisma.appointment.findMany>[0]) => {
    capturedWhere = args?.where;
    return [
      {
        id: "multi-day",
        startTime: at("2026-06-17T08:00:00.000Z"),
        durationMinutes: 4 * 24 * 60,
        client: { name: "Long Client" },
        service: { name: "Retainer" },
      },
    ];
  }) as unknown as typeof prisma.appointment.findMany;

  try {
    const blocks = await loadAppointmentBusyBlocks(ORG, range);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.id, "multi-day");
    assert.equal(blocks[0]?.clientName, "Long Client");

    const startTimeFilter = (capturedWhere as { startTime: { lt: Date; gte?: Date } }).startTime;
    assert.ok(startTimeFilter.lt.getTime() === range.end.getTime());
    assert.equal(startTimeFilter.gte, undefined);

    const availability = await checkSlotAvailability({
      organizationId: ORG,
      startTime: at("2026-06-20T10:30:00.000Z"),
      durationMinutes: 60,
      now: at("2026-06-17T00:00:00.000Z"),
      skipGoogle: true,
    });
    assert.equal(availability.available, false);
    assert.equal(availability.reason, "time_conflict");
    assert.equal(availability.conflict?.appointmentId, "multi-day");
  } finally {
    prisma.appointment.findMany = original;
  }
});

test("resolveDurationMinutes uses service duration when serviceId is provided", async () => {
  const original = prisma.service.findFirst.bind(prisma.service);
  prisma.service.findFirst = (async () => ({ durationMinutes: 60 })) as unknown as typeof prisma.service.findFirst;
  try {
    const duration = await resolveDurationMinutes({
      organizationId: ORG,
      serviceId: SERVICE_ID,
      defaultDurationMinutes: 30,
    });
    assert.equal(duration, 60);
  } finally {
    prisma.service.findFirst = original;
  }
});

test("getCalendarRulesForOrganization loads organization timezone", async () => {
  const original = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => ({ timezone: "Europe/London" })) as unknown as typeof prisma.organization.findUnique;
  try {
    const rules = await getCalendarRulesForOrganization(ORG);
    assert.equal(rules.timeZone, "Europe/London");
    assert.equal(rules.workingStartHour, 7);
    assert.equal(rules.slotStepMinutes, 30);
  } finally {
    prisma.organization.findUnique = original;
  }
});

test("checkSlotAvailability returns time_conflict for overlapping appointment", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as unknown as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => [
    {
      id: "a1",
      startTime: at("2026-06-20T10:00:00.000Z"),
      durationMinutes: 60,
      client: { name: "Dana" },
      service: { name: "Consult" },
    },
  ]) as unknown as typeof prisma.appointment.findMany;

  try {
    const result = await checkSlotAvailability({
      organizationId: ORG,
      startTime: at("2026-06-20T10:30:00.000Z"),
      durationMinutes: 60,
      now: at("2026-06-20T08:00:00.000Z"),
      skipGoogle: true,
    });
    assert.equal(result.available, false);
    assert.equal(result.reason, "time_conflict");
    assert.equal(result.conflict?.appointmentId, "a1");
    assert.equal(result.conflict?.clientName, "Dana");
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
  }
});

test("checkSlotAvailability returns outside_working_hours", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as unknown as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => []) as unknown as typeof prisma.appointment.findMany;

  try {
    const result = await checkSlotAvailability({
      organizationId: ORG,
      startTime: at("2026-06-20T06:00:00.000Z"),
      durationMinutes: 30,
      now: at("2026-06-20T00:00:00.000Z"),
      skipGoogle: true,
    });
    assert.equal(result.available, false);
    assert.equal(result.reason, "outside_working_hours");
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
  }
});

test("checkSlotAvailability returns past for past slots", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as unknown as typeof prisma.organization.findUnique;

  try {
    const result = await checkSlotAvailability({
      organizationId: ORG,
      startTime: at("2026-06-20T08:00:00.000Z"),
      durationMinutes: 30,
      now: at("2026-06-20T12:00:00.000Z"),
    });
    assert.equal(result.available, false);
    assert.equal(result.reason, "past");
  } finally {
    prisma.organization.findUnique = originalOrg;
  }
});

test("findAvailableSlotsForOrganization returns earliest free slots chronologically", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const now = at("2026-06-20T00:00:00.000Z");
  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as unknown as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => []) as unknown as typeof prisma.appointment.findMany;

  try {
    const result = await findAvailableSlotsForOrganization({
      organizationId: ORG,
      rangeType: "day",
      limit: 3,
      now,
      skipGoogle: true,
    });
    assert.equal(result.slots.length, 3);
    assert.equal(result.empty, false);
    assert.equal(result.durationMinutes, 30);
    assert.equal(result.slots[0]?.startTime, "2026-06-20T07:00:00.000Z");
    assert.equal(result.slots[1]?.startTime, "2026-06-20T07:30:00.000Z");
    assert.equal(result.slots[2]?.startTime, "2026-06-20T08:00:00.000Z");
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
  }
});

test("findAvailableSlotsForOrganization: appointment at 11:00 excludes 11:00 from free slots", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  const now = at("2026-06-20T00:00:00.000Z");
  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as unknown as typeof prisma.organization.findUnique;
  prisma.calendarEvent.findMany = (async () => []) as unknown as typeof prisma.calendarEvent.findMany;
  prisma.appointment.findMany = (async () => [
    {
      id: "busy-11",
      startTime: at("2026-06-20T11:00:00.000Z"),
      durationMinutes: 30,
      employeeId: null,
      googleEventId: null,
      status: "confirmed",
      client: { name: "דנה" },
      service: { name: "תספורת" },
    },
  ]) as unknown as typeof prisma.appointment.findMany;

  try {
    const result = await findAvailableSlotsForOrganization({
      organizationId: ORG,
      rangeType: "day",
      limit: 20,
      now,
      skipGoogle: true,
    });
    assert.ok(result.slots.length > 0);
    assert.ok(
      result.slots.every((slot) => slot.startTime !== "2026-06-20T11:00:00.000Z"),
      `11:00 must not be free; got ${result.slots.map((s) => s.label).join(", ")}`
    );
    // Still chronological from Availability Engine
    const starts = result.slots.map((slot) => Date.parse(slot.startTime));
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  }
});

test("findAvailableSlotsForOrganization returns empty for fully busy day", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const now = at("2026-06-20T00:00:00.000Z");
  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as unknown as typeof prisma.organization.findUnique;

  const rows: Array<{
    id: string;
    startTime: Date;
    durationMinutes: number;
    client: { name: string };
    service: null;
  }> = [];
  for (let hour = 7; hour < 21; hour++) {
    for (const minute of [0, 30]) {
      rows.push({
        id: `b-${hour}-${minute}`,
        startTime: at(`2026-06-20T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`),
        durationMinutes: 30,
        client: { name: "Client" },
        service: null,
      });
    }
  }
  prisma.appointment.findMany = (async () => rows) as unknown as typeof prisma.appointment.findMany;

  try {
    const result = await findAvailableSlotsForOrganization({
      organizationId: ORG,
      rangeType: "day",
      limit: 3,
      now,
      skipGoogle: true,
    });
    assert.equal(result.slots.length, 0);
    assert.equal(result.empty, true);
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
  }
});

test("findAvailableSlotsForOrganization week search can return slots across days", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const now = at("2026-06-14T00:00:00.000Z");
  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as unknown as typeof prisma.organization.findUnique;

  const rows: Array<{
    id: string;
    startTime: Date;
    durationMinutes: number;
    client: { name: string };
    service: null;
  }> = [];
  for (let hour = 7; hour < 21; hour++) {
    for (const minute of [0, 30]) {
      rows.push({
        id: `busy-${hour}-${minute}`,
        startTime: at(`2026-06-20T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`),
        durationMinutes: 30,
        client: { name: "Client" },
        service: null,
      });
    }
  }
  prisma.appointment.findMany = (async () => rows) as unknown as typeof prisma.appointment.findMany;

  try {
    const result = await findAvailableSlotsForOrganization({
      organizationId: ORG,
      rangeType: "week",
      limit: 3,
      now,
      skipGoogle: true,
    });
    assert.equal(result.slots.length, 3);
    assert.ok(result.slots.every((slot) => !slot.startTime.startsWith("2026-06-20")));
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
  }
});
