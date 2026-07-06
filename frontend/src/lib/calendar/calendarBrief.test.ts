import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarDailyBrief } from "./calendarBrief";

const baseAppointment = {
  id: "a1",
  startTime: "2026-07-06T10:00:00",
  durationMinutes: 60,
  status: "confirmed",
  client: { name: "דנה" },
  service: { name: "ייעוץ", color: "#3B82F6" },
};

test("buildCalendarDailyBrief builds Hebrew greeting and recommendation for pending approval", () => {
  const brief = buildCalendarDailyBrief({
    now: new Date("2026-07-06T08:00:00"),
    ownerFirstName: "שי",
    todayAppointments: [
      { ...baseAppointment, id: "p1", status: "pending", startTime: "2026-07-06T10:00:00", client: { name: "דנה" } },
      { ...baseAppointment, id: "a2", startTime: "2026-07-06T12:00:00", client: { name: "מיכל" } },
    ],
    openTaskCount: 2,
  });

  assert.match(brief.greeting, /בוקר טוב שי/);
  assert.equal(brief.meetingCount, 2);
  assert.equal(brief.openTaskCount, 2);
  assert.match(brief.summaryLines[0]!, /2 פגישות/);
  assert.match(brief.recommendation, /דנה/);
});

test("buildCalendarDailyBrief suggests scheduling when day is empty", () => {
  const brief = buildCalendarDailyBrief({
    now: new Date("2026-07-06T14:00:00"),
    ownerFirstName: "שי",
    todayAppointments: [],
  });

  assert.equal(brief.meetingCount, 0);
  assert.match(brief.recommendation, /פנוי/);
});
