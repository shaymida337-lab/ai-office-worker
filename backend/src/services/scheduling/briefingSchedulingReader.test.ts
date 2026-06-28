import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  briefingDecisionHref,
  getBriefingSchedulingSnapshot,
} from "./briefingSchedulingReader.js";

const ORG_A = "org-briefing-a";
const ORG_B = "org-briefing-b";
const NOW = new Date("2026-06-20T08:00:00.000Z");
const FROM = new Date("2026-06-20T08:00:00.000Z");
const TO = new Date("2026-07-04T08:00:00.000Z");

function at(iso: string) {
  return new Date(iso);
}

function enableEngineRead() {
  process.env.CALENDAR_ENGINE_V1_READ = "true";
  process.env.CALENDAR_ENGINE_V1_WRITE = "true";
}

function disableEngineRead() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

test("getBriefingSchedulingSnapshot returns appointment-only when engine OFF", async () => {
  disableEngineRead();
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-1",
      startTime: at("2026-06-21T10:00:00.000Z"),
      durationMinutes: 60,
      status: "pending",
      client: { name: "דנה" },
      service: { name: "ייעוץ" },
    },
    {
      id: "appt-old",
      startTime: at("2026-06-19T10:00:00.000Z"),
      durationMinutes: 30,
      status: "confirmed",
      client: { name: "ישן" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;

  try {
    const snapshot = await getBriefingSchedulingSnapshot(ORG_A, { from: FROM, to: TO, now: NOW });
    assert.equal(snapshot.engineReadEnabled, false);
    assert.equal(snapshot.upcoming.length, 1);
    assert.equal(snapshot.upcoming[0]?.source, "appointment");
    assert.equal(snapshot.upcoming[0]?.clientName, "דנה");
    assert.equal(snapshot.upcoming[0]?.statusLabel, "ממתין לאישור");
    assert.equal(snapshot.pendingDecisions.length, 0);
    assert.equal(snapshot.todaySummary.pendingDecisionCount, 1);
  } finally {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
  }
});

test("getBriefingSchedulingSnapshot returns appointment-only when global ON but org OFF", async () => {
  enableEngineRead();
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-org-off",
      startTime: at("2026-06-21T10:00:00.000Z"),
      durationMinutes: 60,
      status: "confirmed",
      client: { name: "דנה" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;

  try {
    const snapshot = await getBriefingSchedulingSnapshot(ORG_A, { from: FROM, to: TO, now: NOW });
    assert.equal(snapshot.engineReadEnabled, false);
    assert.equal(snapshot.upcoming.length, 1);
    assert.equal(snapshot.upcoming[0]?.source, "appointment");
    assert.equal(snapshot.pendingDecisions.length, 0);
  } finally {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
    disableEngineRead();
  }
});

test("getBriefingSchedulingSnapshot returns engine upcoming when engine ON", async () => {
  enableEngineRead();
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    ownerDecisionFindMany: prisma.ownerDecisionQueueItem.findMany.bind(prisma.ownerDecisionQueueItem),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async (args) => {
    const where = args?.where as { status?: { in?: string[] } } | undefined;
    if (where?.status?.in?.includes("completed")) {
      return [{ status: "completed" }, { status: "no_show" }, { status: "cancelled" }];
    }
    return [
      {
        id: "evt-1",
        startAt: at("2026-06-22T09:00:00.000Z"),
        endAt: at("2026-06-22T10:00:00.000Z"),
        status: "confirmed",
        title: "תור",
        client: { name: "רון" },
        service: { name: "טיפול", durationMinutes: 60 },
      },
    ];
  }) as typeof prisma.calendarEvent.findMany;
  prisma.ownerDecisionQueueItem.findMany = (async () => []) as typeof prisma.ownerDecisionQueueItem.findMany;

  try {
    const snapshot = await getBriefingSchedulingSnapshot(ORG_A, { from: FROM, to: TO, now: NOW });
    assert.equal(snapshot.engineReadEnabled, true);
    assert.equal(snapshot.upcoming.length, 1);
    assert.equal(snapshot.upcoming[0]?.source, "calendar_event");
    assert.equal(snapshot.upcoming[0]?.statusLabel, "מאושר");
    assert.equal(snapshot.todaySummary.todayCompletedCount, 1);
    assert.equal(snapshot.todaySummary.todayNoShowCount, 1);
    assert.equal(snapshot.todaySummary.todayCancelledCount, 1);
  } finally {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.ownerDecisionQueueItem.findMany = originals.ownerDecisionFindMany;
    disableEngineRead();
  }
});

test("getBriefingSchedulingSnapshot merges and sorts dual-run items", async () => {
  enableEngineRead();
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    ownerDecisionFindMany: prisma.ownerDecisionQueueItem.findMany.bind(prisma.ownerDecisionQueueItem),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-2",
      startTime: at("2026-06-23T12:00:00.000Z"),
      durationMinutes: 30,
      status: "confirmed",
      client: { name: "מיה" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async (args) => {
    const where = args?.where as { status?: { in?: string[] } } | undefined;
    if (where?.status?.in?.includes("completed")) return [];
    return [
      {
        id: "evt-2",
        startAt: at("2026-06-21T11:00:00.000Z"),
        endAt: at("2026-06-21T12:00:00.000Z"),
        status: "pending_readiness",
        title: "תור חדש",
        client: { name: "יואב" },
        service: null,
      },
    ];
  }) as typeof prisma.calendarEvent.findMany;
  prisma.ownerDecisionQueueItem.findMany = (async () => []) as typeof prisma.ownerDecisionQueueItem.findMany;

  try {
    const snapshot = await getBriefingSchedulingSnapshot(ORG_A, { from: FROM, to: TO, now: NOW });
    assert.equal(snapshot.upcoming.length, 2);
    assert.equal(snapshot.upcoming[0]?.clientName, "יואב");
    assert.equal(snapshot.upcoming[1]?.clientName, "מיה");
  } finally {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.ownerDecisionQueueItem.findMany = originals.ownerDecisionFindMany;
    disableEngineRead();
  }
});

test("getBriefingSchedulingSnapshot returns pending owner decisions", async () => {
  enableEngineRead();
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    ownerDecisionFindMany: prisma.ownerDecisionQueueItem.findMany.bind(prisma.ownerDecisionQueueItem),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;
  prisma.ownerDecisionQueueItem.findMany = (async () => [
    {
      id: "dec-1",
      type: "confirm_appointment",
      title: "אישור תור לדנה",
      reason: "בקשה מנטלי",
      calendarEventId: "evt-9",
      createdAt: at("2026-06-20T07:00:00.000Z"),
    },
  ]) as typeof prisma.ownerDecisionQueueItem.findMany;

  try {
    const snapshot = await getBriefingSchedulingSnapshot(ORG_A, { from: FROM, to: TO, now: NOW });
    assert.equal(snapshot.pendingDecisions.length, 1);
    assert.equal(snapshot.pendingDecisions[0]?.typeLabel, "אישור תור");
    assert.equal(snapshot.pendingDecisions[0]?.href, briefingDecisionHref("dec-1"));
    assert.equal(snapshot.todaySummary.pendingDecisionCount, 1);
  } finally {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.ownerDecisionQueueItem.findMany = originals.ownerDecisionFindMany;
    disableEngineRead();
  }
});

test("getBriefingSchedulingSnapshot enforces organization isolation", async () => {
  disableEngineRead();
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string } | undefined;
    assert.equal(where?.organizationId, ORG_B);
    return [];
  }) as typeof prisma.appointment.findMany;

  try {
    const snapshot = await getBriefingSchedulingSnapshot(ORG_B, { from: FROM, to: TO, now: NOW });
    assert.equal(snapshot.upcoming.length, 0);
  } finally {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
  }
});
