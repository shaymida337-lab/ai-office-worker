import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import { askNatalieBusinessQuestion } from "./natalie.js";
import {
  isAppointmentWriteIntent,
  isAvailabilityQuestion,
  maybeBuildAvailabilityResponse,
  parseAvailabilityIntent,
} from "./natalieAvailability.js";

const ORG = "org-natalie-availability";
const FIXED_NOW = new Date("2026-06-20T08:00:00.000Z");

function at(iso: string) {
  return new Date(iso);
}

function installAvailabilityPrismaStub(options?: {
  appointments?: Array<{
    id: string;
    startTime: Date;
    durationMinutes: number;
    client: { name: string };
    service: { name: string } | null;
  }>;
}) {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    serviceFindFirst: prisma.service.findFirst.bind(prisma.service),
  };

  prisma.organization.findUnique = (async () => ({ timezone: "UTC" })) as unknown as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => options?.appointments ?? []) as unknown as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as unknown as typeof prisma.calendarEvent.findMany;
  prisma.service.findFirst = (async () => null) as unknown as typeof prisma.service.findFirst;

  return () => {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.service.findFirst = originals.serviceFindFirst;
  };
}

test("parseAvailabilityIntent detects general free-time question as week suggest", () => {
  const intent = parseAvailabilityIntent("מתי אני פנוי?");
  assert.equal(intent.kind, "suggest");
  assert.equal(intent.rangeType, "week");
  assert.equal(intent.limit, 3);
});

test("parseAvailabilityIntent detects tomorrow availability", () => {
  const intent = parseAvailabilityIntent("יש לי זמן מחר?");
  assert.equal(intent.kind, "suggest");
  assert.equal(intent.dayReference, "מחר");
  assert.equal(intent.rangeType, "day");
});

test("parseAvailabilityIntent detects week hour search with 60 minute duration", () => {
  const intent = parseAvailabilityIntent("תמצא לי שעה השבוע");
  assert.equal(intent.kind, "suggest");
  assert.equal(intent.rangeType, "week");
  assert.equal(intent.durationMinutes, 60);
});

test("parseAvailabilityIntent detects suggest three slots", () => {
  const intent = parseAvailabilityIntent("תציעי לי שלושה זמנים");
  assert.equal(intent.kind, "suggest");
  assert.equal(intent.limit, 3);
});

test("parseAvailabilityIntent detects first available slot", () => {
  const intent = parseAvailabilityIntent("מה הזמן הראשון הפנוי?");
  assert.equal(intent.kind, "suggest");
  assert.equal(intent.firstOnly, true);
  assert.equal(intent.limit, 1);
});

test("parseAvailabilityIntent detects check at specific time", () => {
  const intent = parseAvailabilityIntent("יש מקום מחר ב-10?");
  assert.equal(intent.kind, "check");
  assert.equal(intent.dayReference, "מחר");
  assert.equal(intent.time, "10:00");
});

test("parseAvailabilityIntent detects free at three o'clock as afternoon business hours", () => {
  const intent = parseAvailabilityIntent("פנוי בשלוש?");
  assert.equal(intent.kind, "check");
  assert.equal(intent.time, "15:00");
});

test("parseAvailabilityIntent maps bare digit three to afternoon business hours", () => {
  const intent = parseAvailabilityIntent("פנוי ב-3?");
  assert.equal(intent.kind, "check");
  assert.equal(intent.time, "15:00");
});

test("parseAvailabilityIntent keeps explicit 03:00 as early morning", () => {
  const intent = parseAvailabilityIntent("פנוי ב-03:00?");
  assert.equal(intent.kind, "check");
  assert.equal(intent.time, "03:00");
});

test("parseAvailabilityIntent keeps explicit 15:00 as afternoon", () => {
  const intent = parseAvailabilityIntent("פנוי ב-15:00?");
  assert.equal(intent.kind, "check");
  assert.equal(intent.time, "15:00");
});

test("parseAvailabilityIntent ignores book appointment phrasing", () => {
  assert.equal(isAppointmentWriteIntent("תקבעי תור לדנה מחר ב-10"), true);
  assert.equal(isAvailabilityQuestion("תקבעי תור לדנה מחר ב-10"), false);
  assert.equal(parseAvailabilityIntent("תקבעי תור לדנה מחר ב-10").kind, "none");
});

test("parseAvailabilityIntent ignores cancel and reschedule phrasing", () => {
  assert.equal(parseAvailabilityIntent("בטלי את התור של דנה").kind, "none");
  assert.equal(parseAvailabilityIntent("תעבירי את התור של דנה למחר ב-4").kind, "none");
});

test("maybeBuildAvailabilityResponse returns suggest_available_times with engine slots", async () => {
  const restore = installAvailabilityPrismaStub();
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "תציעי לי שלושה זמנים", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    assert.equal("action" in result && result.action, "suggest_available_times");
    if (!("action" in result) || result.action !== "suggest_available_times") return;
    assert.equal(result.proposal.slots.length, 3);
    assert.equal(result.proposal.intent, "suggest");
    assert.match(result.answer, /מצאתי 3 זמנים פנויים/);
    assert.equal(result.proposal.slots[0]?.startTime, "2026-06-20T08:00:00.000Z");
  } finally {
    restore();
  }
});

test("maybeBuildAvailabilityResponse returns answer-only for available check", async () => {
  const restore = installAvailabilityPrismaStub();
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "יש מקום מחר ב-10?", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    assert.equal("answer" in result && !("action" in result), true);
    assert.match(result.answer, /כן, השעה פנויה/);
  } finally {
    restore();
  }
});

test("maybeBuildAvailabilityResponse returns nearby alternatives when check finds conflict", async () => {
  const restore = installAvailabilityPrismaStub({
    appointments: [
      {
        id: "busy",
        startTime: at("2026-06-21T10:00:00.000Z"),
        durationMinutes: 30,
        client: { name: "דנה" },
        service: null,
      },
    ],
  });
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "יש מקום מחר ב-10?", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    assert.equal("action" in result && result.action, "suggest_available_times");
    if (!("action" in result) || result.action !== "suggest_available_times") return;
    assert.equal(result.proposal.intent, "check_alternatives");
    assert.match(result.answer, /השעה 10:00 מחר תפוסה/);
    assert.match(result.answer, /בגלל פגישה עם דנה/);
    assert.equal(result.proposal.slots.length, 3);
    const starts = result.proposal.slots.map((slot) => new Date(slot.startTime).toISOString());
    assert.deepEqual(starts, [
      "2026-06-21T09:30:00.000Z",
      "2026-06-21T10:30:00.000Z",
      "2026-06-21T11:00:00.000Z",
    ]);
  } finally {
    restore();
  }
});

test("maybeBuildAvailabilityResponse falls back to next day when requested day is fully booked", async () => {
  const restore = installAvailabilityPrismaStub();
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
        startTime: at(`2026-06-21T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`),
        durationMinutes: 30,
        client: { name: "Client" },
        service: null,
      });
    }
  }
  prisma.appointment.findMany = (async () => rows) as unknown as typeof prisma.appointment.findMany;
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "יש מקום מחר ב-10?", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    assert.equal("action" in result && result.action, "suggest_available_times");
    if (!("action" in result) || result.action !== "suggest_available_times") return;
    assert.match(result.answer, /השעה 10:00 מחר תפוסה/);
    assert.match(result.answer, /לא מצאתי מקום באותו יום/);
    assert.ok(result.proposal.slots.length > 0);
    const firstStart = new Date(result.proposal.slots[0]!.startTime);
    assert.equal(firstStart.toISOString().slice(0, 10), "2026-06-22");
  } finally {
    restore();
  }
});

test("maybeBuildAvailabilityResponse does not suggest slots outside working hours", async () => {
  const restore = installAvailabilityPrismaStub({
    appointments: [
      {
        id: "busy",
        startTime: at("2026-06-21T10:00:00.000Z"),
        durationMinutes: 30,
        client: { name: "דנה" },
        service: null,
      },
    ],
  });
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "יש מקום מחר ב-10?", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    if (!("action" in result) || result.action !== "suggest_available_times") return;
    for (const slot of result.proposal.slots) {
      const start = new Date(slot.startTime);
      const hour = start.getUTCHours();
      const minute = start.getUTCMinutes();
      assert.ok(hour >= 7 && (hour < 21 || (hour === 21 && minute === 0)));
      assert.ok(hour < 21 || (hour === 21 && minute === 0));
    }
  } finally {
    restore();
  }
});

test("maybeBuildAvailabilityResponse returns empty schedule message", async () => {
  const restore = installAvailabilityPrismaStub();
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
        startTime: at(`2026-06-21T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`),
        durationMinutes: 30,
        client: { name: "Client" },
        service: null,
      });
    }
  }
  prisma.appointment.findMany = (async () => rows) as unknown as typeof prisma.appointment.findMany;
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "מה פנוי מחר?", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    assert.equal("answer" in result && !("action" in result), true);
    assert.match(result.answer, /לא מצאתי זמנים פנויים/);
  } finally {
    restore();
  }
});

test("maybeBuildAvailabilityResponse handles outside working hours", async () => {
  const restore = installAvailabilityPrismaStub();
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "יש מקום מחר ב-05:00?", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    assert.equal("answer" in result && !("action" in result), true);
    assert.match(result.answer, /מחוץ לשעות הפעילות/);
  } finally {
    restore();
  }
});

test("maybeBuildAvailabilityResponse handles invalid date or time", async () => {
  const restore = installAvailabilityPrismaStub();
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "יש מקום מחר ב-25?", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    assert.equal("answer" in result && !("action" in result), true);
    assert.match(result.answer, /לא הבנתי את התאריך או השעה/);
  } finally {
    restore();
  }
});

test("maybeBuildAvailabilityResponse handles past slot check", async () => {
  const restore = installAvailabilityPrismaStub();
  try {
    const result = await maybeBuildAvailabilityResponse(ORG, "יש מקום היום ב-07:00?", {
      now: FIXED_NOW,
    });
    assert.ok(result);
    assert.equal("answer" in result && !("action" in result), true);
    assert.match(result.answer, /כבר עברה/);
  } finally {
    restore();
  }
});

test("askNatalieBusinessQuestion routes availability before reschedule handler", async () => {
  const restore = installAvailabilityPrismaStub();
  mock.timers.enable({ apis: ["Date"], now: FIXED_NOW });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "מתי אני פנוי?",
    });
    assert.equal("action" in result && result.action, "suggest_available_times");
  } finally {
    mock.timers.reset();
    restore();
  }
});
