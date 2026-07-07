import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { parseCalendarCommand } from "./calendarCommandParser.js";
import { getFreeSlots, getNextAvailableSlot } from "./calendarAvailabilityService.js";
import {
  createAppointment,
} from "./calendarSchedulingService.js";
import { executeParsedCalendarCommand } from "./calendarAIService.js";

const ORG = "org-calendar-phase1";
const USER = "user-calendar-phase1";

function disableEngineFlags() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

test("parseCalendarCommand maps Hebrew create request", () => {
  const parsed = parseCalendarCommand("קבע תור לשרית מחר בשעה 15:00");
  assert.equal(parsed.action, "create");
  assert.equal(parsed.customer, "שרית");
  assert.equal(parsed.dayReference, "מחר");
  assert.equal(parsed.time, "15:00");
});

test("parseCalendarCommand maps English create request", () => {
  const parsed = parseCalendarCommand("Schedule Sarit tomorrow at 15:00");
  assert.equal(parsed.action, "create");
  assert.match(parsed.customer ?? "", /Sarit/i);
  assert.equal(parsed.dayReference, "tomorrow");
  assert.equal(parsed.time, "15:00");
});

test("parseCalendarCommand maps cancel and move intents", () => {
  assert.equal(parseCalendarCommand("בטלי את התור של דוד").action, "cancel");
  const move = parseCalendarCommand("תעביר את התור של מיכל למחר בשעה 16:00");
  assert.equal(move.action, "move");
  assert.equal(move.dayReference, "מחר");
  assert.equal(move.time, "16:00");
});

test("parseCalendarCommand maps availability lookup", () => {
  const parsed = parseCalendarCommand("פנוי מחר בשעה 15:00");
  assert.equal(parsed.action, "availability_check");
  assert.equal(parsed.dayReference, "מחר");
  assert.equal(parsed.time, "15:00");
});

test("availability service returns free slots with mocked busy blocks", async () => {
  disableEngineFlags();
  const restoreOrg = mockOrganizationTimezone();
  const restoreBlocks = mockEmptyCombinedBlocks();

  const result = await getFreeSlots({
    organizationId: ORG,
    dayReference: "מחר",
    durationMinutes: 30,
    limit: 3,
    now: new Date("2026-12-15T08:00:00.000Z"),
  });

  assert.equal(result.empty, false);
  assert.ok(result.slots.length > 0);

  restoreBlocks();
  restoreOrg();
});

test("createAppointment delegates to Natalie booking workflow", async () => {
  disableEngineFlags();
  const restoreOrg = mockOrganizationTimezone();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreTx = mockPassthroughTransaction();

  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  const originalCreateClient = prisma.client.create.bind(prisma.client);
  const originalCreateAppt = prisma.appointment.create.bind(prisma.appointment);
  const originalFindFirst = prisma.appointment.findFirst.bind(prisma.appointment);

  prisma.client.findMany = (async () => [
    { id: "client-1", name: "Sarit", email: null, whatsappNumber: null },
  ]) as typeof prisma.client.findMany;
  prisma.client.create = (async () => {
    throw new Error("should not create client");
  }) as typeof prisma.client.create;
  prisma.appointment.findFirst = (async () => null) as typeof prisma.appointment.findFirst;
  prisma.appointment.create = (async (args) => ({
    id: "appt-1",
    organizationId: ORG,
    clientId: "client-1",
    startTime: new Date("2026-12-16T13:00:00.000Z"),
    durationMinutes: 30,
    status: "scheduled",
    client: { id: "client-1", name: "Sarit" },
    service: null,
    ...args.data,
  })) as typeof prisma.appointment.create;

  const booked = await createAppointment({
    organizationId: ORG,
    userId: USER,
    clientName: "Sarit",
    dayReference: "מחר",
    time: "15:00",
  });

  assert.equal(booked.engine, false);
  assert.equal(booked.appointment.id, "appt-1");

  prisma.client.findMany = originalFindMany;
  prisma.client.create = originalCreateClient;
  prisma.appointment.create = originalCreateAppt;
  prisma.appointment.findFirst = originalFindFirst;
  restoreTx();
  restoreBlocks();
  restoreOrg();
});

test("validateSlotRequest detects overlapping appointments", async () => {
  disableEngineFlags();
  const restoreOrg = mockOrganizationTimezone();
  const restoreBlocks = mockBusyBlocks();

  const { validateSlotRequest } = await import("./calendarValidationService.js");
  const result = await validateSlotRequest({
    organizationId: ORG,
    dayReference: "מחר",
    time: "15:00",
    now: new Date("2026-12-15T08:00:00.000Z"),
  });

  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.code, "time_conflict");

  restoreBlocks();
  restoreOrg();
});

test("executeParsedCalendarCommand returns conflict suggestion message", async () => {
  disableEngineFlags();
  const restoreOrg = mockOrganizationTimezone();
  const restoreBlocks = mockBusyBlocks();
  const restoreTx = mockPassthroughTransaction();

  const response = await executeParsedCalendarCommand({
    organizationId: ORG,
    userId: USER,
    parsed: parseCalendarCommand("קבע תור לשרית מחר בשעה 15:00"),
    now: new Date("2026-12-15T08:00:00.000Z"),
  });

  assert.equal(response.result.ok, false);
  assert.match(response.message, /כבר יש לך תור|הזמן הפנוי הקרוב/);

  restoreTx();
  restoreBlocks();
  restoreOrg();
});

test("executeParsedCalendarCommand handles list appointments", async () => {
  disableEngineFlags();
  const originalFindMany = prisma.appointment.findMany.bind(prisma.appointment);
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-list-1",
      startTime: new Date("2026-12-20T10:00:00.000Z"),
      durationMinutes: 30,
      client: { id: "client-1", name: "Sarit" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;

  const response = await executeParsedCalendarCommand({
    organizationId: ORG,
    userId: USER,
    parsed: parseCalendarCommand("מה התורים שלי"),
  });

  assert.equal(response.result.ok, true);
  assert.match(response.message, /תורים קרובים/);

  prisma.appointment.findMany = originalFindMany;
});

function mockOrganizationTimezone() {
  const original = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => ({
    timezone: "Asia/Jerusalem",
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  return () => {
    prisma.organization.findUnique = original;
  };
}

function mockEmptyCombinedBlocks() {
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;
  return () => {
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  };
}

function mockBusyBlocks() {
  const restoreEmpty = mockEmptyCombinedBlocks();
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  prisma.appointment.findMany = (async () => [
    {
      id: "busy-1",
      startTime: new Date("2026-12-16T13:00:00.000Z"),
      durationMinutes: 60,
      status: "scheduled",
      client: { name: "Busy Client" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;
  return () => {
    prisma.appointment.findMany = originalAppt;
    restoreEmpty();
  };
}

function mockPassthroughTransaction() {
  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalExecuteRaw = prisma.$executeRaw.bind(prisma);
  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;
  prisma.$executeRaw = (async () => 1) as typeof prisma.$executeRaw;
  return () => {
    prisma.$transaction = originalTransaction;
    prisma.$executeRaw = originalExecuteRaw;
  };
}
