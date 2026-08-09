import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLastListedAppointmentsPendingAction,
  parseListedAppointmentOrdinalCommand,
  filterListedAppointments,
} from "./lastListedAppointments.js";
import { computeFreeWindows } from "../calendar/engine.js";
import { calendarMessages } from "../calendar/calendarMessages.js";

test("chooser filter cancel: תבטלי את התור של יום ראשון", () => {
  const command = parseListedAppointmentOrdinalCommand("תבטלי את התור של יום ראשון");
  assert.equal(command?.intent, "cancel_appointment");
  assert.equal(command?.ordinal, null);
  assert.equal(command?.filter?.dayReference, "יום ראשון");
});

test("bare ordinal הראשון applies preferred", () => {
  const command = parseListedAppointmentOrdinalCommand("הראשון");
  assert.equal(command?.intent, "apply_preferred");
  assert.deepEqual(command?.ordinal, { kind: "first" });
});

test("cancel multi-select pending action stores preferredAction + expiresAt", () => {
  const pending = buildLastListedAppointmentsPendingAction(
    [
      {
        id: "a1",
        source: "appointment",
        clientId: "c-sarit",
        clientName: "שרית",
        startTime: new Date("2026-07-19T10:00:00.000Z"),
        durationMinutes: 30,
        status: "confirmed",
      },
      {
        id: "a2",
        source: "appointment",
        clientId: "c-sarit",
        clientName: "שרית",
        startTime: new Date("2026-07-20T12:00:00.000Z"),
        durationMinutes: 30,
        status: "confirmed",
      },
    ],
    {
      preferredAction: "cancel_appointment",
      clientId: "c-sarit",
      clientName: "שרית",
    }
  );
  assert.equal(pending?.action, "last_listed_appointments");
  assert.equal(pending?.proposal.preferredAction, "cancel_appointment");
  assert.equal(pending?.proposal.clientName, "שרית");
  assert.ok(typeof pending?.proposal.expiresAt === "string");
  assert.ok(Array.isArray(pending?.proposal.items) && pending!.proposal.items.length === 2);
});

test("filterListedAppointments keeps Sunday appointments", () => {
  const items = [
    {
      appointmentId: "sun",
      source: "appointment" as const,
      startTime: "2026-07-19T10:00:00.000Z", // Sunday Asia/Jerusalem morning area depending on TZ
      endTime: "2026-07-19T10:30:00.000Z",
      customerName: "שרית",
    },
    {
      appointmentId: "mon",
      source: "appointment" as const,
      startTime: "2026-07-20T10:00:00.000Z",
      endTime: "2026-07-20T10:30:00.000Z",
      customerName: "שרית",
    },
  ];
  const filtered = filterListedAppointments(items, { dayReference: "יום ראשון" }, "Asia/Jerusalem");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.appointmentId, "sun");
});

test("computeFreeWindows: one busy block yields two free ranges", () => {
  const workDay = {
    start: new Date("2026-06-20T04:00:00.000Z"), // 07:00 IL
    end: new Date("2026-06-20T18:00:00.000Z"), // 21:00 IL
  };
  const windows = computeFreeWindows(
    workDay,
    [
      {
        id: "busy",
        source: "appointment",
        start: new Date("2026-06-20T10:57:00.000Z"),
        end: new Date("2026-06-20T11:30:00.000Z"),
        clientName: "דני",
      },
    ],
    { now: new Date("2026-06-20T04:00:00.000Z") }
  );
  assert.equal(windows.length, 2);
  assert.equal(windows[0]?.start.toISOString(), "2026-06-20T04:00:00.000Z");
  assert.equal(windows[0]?.end.toISOString(), "2026-06-20T10:57:00.000Z");
  assert.equal(windows[1]?.start.toISOString(), "2026-06-20T11:30:00.000Z");
  assert.equal(windows[1]?.end.toISOString(), "2026-06-20T18:00:00.000Z");
});

test("availabilityFreeWindows copy has no provenance jargon", () => {
  const answer = calendarMessages.availabilityFreeWindows({
    dayLabel: "היום",
    windows: [
      { startLabel: "07:00", endLabel: "13:57" },
      { startLabel: "14:30", endLabel: "21:00" },
    ],
    meetings: [{ whenLabel: "13:57", clientName: "דני" }],
  });
  assert.match(answer, /פגישה אחת בלבד/);
  assert.match(answer, /07:00–13:57/);
  assert.doesNotMatch(answer, /מקור נתונים|Google Calendar|תמונה מלאה|provenance/i);
});
