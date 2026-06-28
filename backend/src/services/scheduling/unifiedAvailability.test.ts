import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { checkSlotAvailability, findAvailableSlotsForOrganization } from "../calendar/availability.js";
import { loadCombinedBusyBlocks } from "../calendar/calendarEventBlocks.js";

const ORG = "org-unified-availability";

function at(iso: string) {
  return new Date(iso);
}

function mockEmptyCalendarEvents() {
  const original = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;
  return () => {
    prisma.calendarEvent.findMany = original;
  };
}

test("loadCombinedBusyBlocks merges appointment and calendar event blocks", async () => {
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  prisma.appointment.findMany = (async () => [
    {
      id: "appt-1",
      startTime: at("2026-06-20T10:00:00.000Z"),
      durationMinutes: 60,
      client: { name: "Legacy Client" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;

  prisma.calendarEvent.findMany = (async () => [
    {
      id: "evt-1",
      startAt: at("2026-06-20T14:00:00.000Z"),
      endAt: at("2026-06-20T15:00:00.000Z"),
      client: { name: "Engine Client" },
      service: null,
    },
  ]) as typeof prisma.calendarEvent.findMany;

  try {
    const blocks = await loadCombinedBusyBlocks(ORG, {
      start: at("2026-06-20T08:00:00.000Z"),
      end: at("2026-06-20T18:00:00.000Z"),
    });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.source, "appointment");
    assert.equal(blocks[1]?.source, "calendar_event");
  } finally {
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  }
});

test("unified checkSlotAvailability detects appointment conflict", async () => {
  const restoreEvents = mockEmptyCalendarEvents();
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);

  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-busy",
      startTime: at("2026-06-20T10:00:00.000Z"),
      durationMinutes: 60,
      client: { name: "Busy" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;

  try {
    const result = await checkSlotAvailability({
      organizationId: ORG,
      startTime: at("2026-06-20T10:30:00.000Z"),
      durationMinutes: 60,
      now: at("2026-06-20T08:00:00.000Z"),
    });
    assert.equal(result.available, false);
    assert.equal(result.reason, "time_conflict");
    assert.equal(result.conflict?.appointmentId, "appt-busy");
  } finally {
    restoreEvents();
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
  }
});

test("unified checkSlotAvailability detects calendar engine conflict", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => [
    {
      id: "evt-busy",
      startAt: at("2026-06-20T11:00:00.000Z"),
      endAt: at("2026-06-20T12:00:00.000Z"),
      client: { name: "Engine" },
      service: null,
    },
  ]) as typeof prisma.calendarEvent.findMany;

  try {
    const result = await checkSlotAvailability({
      organizationId: ORG,
      startTime: at("2026-06-20T11:30:00.000Z"),
      durationMinutes: 60,
      now: at("2026-06-20T08:00:00.000Z"),
    });
    assert.equal(result.available, false);
    assert.equal(result.reason, "time_conflict");
    assert.equal(result.conflict?.appointmentId, "evt-busy");
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  }
});

test("unified checkSlotAvailability detects conflict when both sources block", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-1",
      startTime: at("2026-06-20T09:00:00.000Z"),
      durationMinutes: 60,
      client: { name: "A" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => [
    {
      id: "evt-1",
      startAt: at("2026-06-20T10:00:00.000Z"),
      endAt: at("2026-06-20T11:00:00.000Z"),
      client: { name: "B" },
      service: null,
    },
  ]) as typeof prisma.calendarEvent.findMany;

  try {
    const apptConflict = await checkSlotAvailability({
      organizationId: ORG,
      startTime: at("2026-06-20T09:30:00.000Z"),
      durationMinutes: 60,
      now: at("2026-06-20T08:00:00.000Z"),
    });
    assert.equal(apptConflict.available, false);

    const engineConflict = await checkSlotAvailability({
      organizationId: ORG,
      startTime: at("2026-06-20T10:30:00.000Z"),
      durationMinutes: 60,
      now: at("2026-06-20T08:00:00.000Z"),
    });
    assert.equal(engineConflict.available, false);
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  }
});

test("unified findAvailableSlotsForOrganization skips slots blocked by either source", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-1",
      startTime: at("2026-06-20T10:00:00.000Z"),
      durationMinutes: 60,
      client: { name: "A" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => [
    {
      id: "evt-1",
      startAt: at("2026-06-20T12:00:00.000Z"),
      endAt: at("2026-06-20T13:00:00.000Z"),
      client: { name: "B" },
      service: null,
    },
  ]) as typeof prisma.calendarEvent.findMany;

  try {
    const result = await findAvailableSlotsForOrganization({
      organizationId: ORG,
      from: at("2026-06-20T07:00:00.000Z"),
      to: at("2026-06-20T21:00:00.000Z"),
      durationMinutes: 60,
      limit: 10,
      now: at("2026-06-20T07:00:00.000Z"),
    });
    assert.ok(result.slots.length > 0);
    for (const slot of result.slots) {
      const start = new Date(slot.startTime).getTime();
      const overlapsAppt =
        start < at("2026-06-20T11:00:00.000Z").getTime() &&
        start + 60 * 60_000 > at("2026-06-20T10:00:00.000Z").getTime();
      const overlapsEvt =
        start < at("2026-06-20T13:00:00.000Z").getTime() &&
        start + 60 * 60_000 > at("2026-06-20T12:00:00.000Z").getTime();
      assert.equal(overlapsAppt, false);
      assert.equal(overlapsEvt, false);
    }
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  }
});
