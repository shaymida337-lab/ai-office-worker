import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAppointmentNameSimilarity,
  extractActiveCalendarContext,
  findBestAppointmentNameMatch,
  normalizeHebrewAppointmentText,
} from "./calendarAppointmentResolver.js";
import type { UpcomingSchedulingItemWithClient } from "./calendarAppointmentResolver.js";

const TUESDAY_APPOINTMENT: UpcomingSchedulingItemWithClient = {
  id: "appt-yossi",
  clientId: "client-yossi",
  clientName: "יוסי ביטון",
  startTime: new Date("2026-07-07T12:00:00.000Z"),
  durationMinutes: 60,
};

test("normalizeHebrewAppointmentText strips nikud and punctuation", () => {
  assert.equal(normalizeHebrewAppointmentText("יֹוסִי ביטון!"), "יוסי ביטון");
});

test("computeAppointmentNameSimilarity matches STT-misheard first name with exact last name", () => {
  const score = computeAppointmentNameSimilarity("גרסי ביטון", "יוסי ביטון");
  assert.ok(score >= 0.65, `expected >= 0.65, got ${score}`);
});

test("computeAppointmentNameSimilarity rejects unrelated names", () => {
  const score = computeAppointmentNameSimilarity("דני כהן", "יוסי ביטון");
  assert.ok(score < 0.65, `expected < 0.65, got ${score}`);
});

test("findBestAppointmentNameMatch picks יוסי ביטון for גרסי ביטון", () => {
  const match = findBestAppointmentNameMatch("גרסי ביטון", [TUESDAY_APPOINTMENT]);
  assert.ok(match);
  assert.equal(match.appointment.clientName, "יוסי ביטון");
  assert.ok(match.matchScore >= 0.65);
});

test("extractActiveCalendarContext reads pending reschedule proposal", () => {
  const context = extractActiveCalendarContext({
    pendingAction: {
      action: "reschedule_appointment",
      proposal: {
        appointmentId: "appt-yossi",
        clientId: "client-yossi",
        clientName: "יוסי ביטון",
        newWhen: "יום חמישי, 15:00",
      },
    },
  });
  assert.equal(context?.clientName, "יוסי ביטון");
  assert.equal(context?.appointmentId, "appt-yossi");
});

test("extractActiveCalendarContext walks structured history backwards", () => {
  const context = extractActiveCalendarContext({
    history: [
      { role: "user", content: "שלום" },
      {
        role: "assistant",
        content: "מצאתי תור ליוסי ביטון",
        action: "cancel_appointment",
        proposal: {
          appointmentId: "appt-yossi",
          clientId: "client-yossi",
          clientName: "יוסי ביטון",
        },
      },
    ],
  });
  assert.equal(context?.clientName, "יוסי ביטון");
});

test("extractActiveCalendarContext reads client from list bullet response", () => {
  const context = extractActiveCalendarContext({
    history: [
      { role: "user", content: "מה יש לי לעשות היום" },
      {
        role: "assistant",
        content: "התורים שלך להיום:\n• 16:00 — שרית",
      },
    ],
  });
  assert.equal(context?.clientName, "שרית");
});
