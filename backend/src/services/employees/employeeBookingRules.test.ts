import test from "node:test";
import assert from "node:assert/strict";
import {
  decideEmployeeBooking,
  findBookingOverlap,
  isOnVacation,
  isValidLocalDateKey,
  isWithinEmployeeWorkingHours,
  localDateKey,
  localMinutesOfDay,
  localWeekday,
  parseTimeToMinutes,
  validateWeeklySchedule,
} from "./employeeBookingRules.js";

const TZ = "Asia/Jerusalem";

// 2026-07-15 הוא יום רביעי (dayOfWeek=3). קיץ בישראל: UTC+3,
// כלומר 06:00Z = 09:00 מקומית.
const wednesdayLocal = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 6, 15, hour - 3, minute));

const interval = (startHourLocal: number, durationMinutes: number, minute = 0) => {
  const start = wednesdayLocal(startHourLocal, minute);
  return { start, end: new Date(start.getTime() + durationMinutes * 60_000) };
};

const WEDNESDAY_SCHEDULE = [
  { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", breaks: [{ start: "12:00", end: "12:30" }] },
];

test("time parsing and local helpers work in the organization timezone", () => {
  assert.equal(parseTimeToMinutes("09:30"), 570);
  assert.equal(parseTimeToMinutes("24:00"), null);
  assert.equal(parseTimeToMinutes("nope"), null);
  assert.ok(isValidLocalDateKey("2026-07-15"));
  assert.ok(!isValidLocalDateKey("2026-13-01"));
  assert.equal(localWeekday(wednesdayLocal(9), TZ), 3);
  assert.equal(localDateKey(wednesdayLocal(9), TZ), "2026-07-15");
  // 06:00Z = 09:00 בישראל — הוכחה שהחישוב מקומי ולא UTC
  assert.equal(localMinutesOfDay(new Date(Date.UTC(2026, 6, 15, 6, 0)), TZ), 9 * 60);
});

test("working hours: inside allowed, outside/day-off/overflow blocked — computed in org timezone", () => {
  const base = { timeZone: TZ, schedule: WEDNESDAY_SCHEDULE };
  assert.ok(isWithinEmployeeWorkingHours({ ...base, interval: interval(9, 60) }), "09:00-10:00 in hours");
  assert.ok(!isWithinEmployeeWorkingHours({ ...base, interval: interval(8, 60) }), "08:00 before start");
  assert.ok(!isWithinEmployeeWorkingHours({ ...base, interval: interval(16, 90) }), "16:00+90m crosses end");
  assert.ok(
    isWithinEmployeeWorkingHours({ ...base, interval: interval(16, 60) }),
    "16:00-17:00 exactly ends at close"
  );
  // 09:00 ביום חמישי — אין רשומה ליום 4 → מחוץ לשעות
  const thursday = new Date(Date.UTC(2026, 6, 16, 6, 0));
  assert.ok(
    !isWithinEmployeeWorkingHours({
      ...base,
      interval: { start: thursday, end: new Date(thursday.getTime() + 30 * 60_000) },
    }),
    "day without schedule entry is not a working day"
  );
  // לוח ריק = אין הגבלה (עובד בלי שעות מוגדרות לא נחסם)
  assert.ok(isWithinEmployeeWorkingHours({ interval: interval(6, 30), timeZone: TZ, schedule: [] }));
});

test("breaks block overlapping bookings but allow back-to-back edges", () => {
  const base = { timeZone: TZ, schedule: WEDNESDAY_SCHEDULE };
  assert.ok(!isWithinEmployeeWorkingHours({ ...base, interval: interval(12, 15) }), "12:00 inside break");
  assert.ok(!isWithinEmployeeWorkingHours({ ...base, interval: interval(11, 90) }), "11:00+90m overlaps break");
  assert.ok(isWithinEmployeeWorkingHours({ ...base, interval: interval(11, 60) }), "11:00-12:00 ends at break");
  assert.ok(
    isWithinEmployeeWorkingHours({ ...base, interval: interval(12, 30, 30) }),
    "12:30 starts when break ends"
  );
});

test("vacation: inclusive local date range", () => {
  const vacations = [{ startDate: "2026-07-15", endDate: "2026-07-16" }];
  assert.ok(isOnVacation({ start: wednesdayLocal(9), timeZone: TZ, vacations }));
  assert.ok(
    isOnVacation({ start: new Date(Date.UTC(2026, 6, 16, 6, 0)), timeZone: TZ, vacations }),
    "end date inclusive"
  );
  assert.ok(
    !isOnVacation({ start: new Date(Date.UTC(2026, 6, 17, 6, 0)), timeZone: TZ, vacations }),
    "day after vacation is free"
  );
  // 23:30 מקומית ב-14.7 זה 20:30Z — עדיין לא בחופשה שמתחילה ב-15.7
  assert.ok(
    !isOnVacation({ start: new Date(Date.UTC(2026, 6, 14, 20, 30)), timeZone: TZ, vacations }),
    "local date boundary respected"
  );
});

test("double booking: overlap detected, exclude id and edges respected", () => {
  const existing = [
    { id: "a1", start: wednesdayLocal(10), end: wednesdayLocal(11) },
  ];
  assert.ok(findBookingOverlap(interval(10, 30), existing), "same slot overlaps");
  assert.ok(findBookingOverlap(interval(10, 90, 30), existing), "partial overlap detected");
  assert.equal(findBookingOverlap(interval(11, 30), existing), null, "back-to-back allowed");
  assert.equal(
    findBookingOverlap(interval(10, 30), existing, { excludeId: "a1" }),
    null,
    "editing the same appointment does not conflict with itself"
  );
});

test("validateWeeklySchedule rejects bad input and normalizes good input", () => {
  assert.ok(!validateWeeklySchedule("nope").ok);
  assert.ok(!validateWeeklySchedule([{ dayOfWeek: 9, startTime: "09:00", endTime: "17:00" }]).ok);
  assert.ok(!validateWeeklySchedule([{ dayOfWeek: 1, startTime: "18:00", endTime: "09:00" }]).ok);
  assert.ok(
    !validateWeeklySchedule([
      { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: 1, startTime: "10:00", endTime: "12:00" },
    ]).ok,
    "duplicate day rejected"
  );
  assert.ok(
    !validateWeeklySchedule([
      { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", breaks: [{ start: "08:00", end: "10:00" }] },
    ]).ok,
    "break outside working hours rejected"
  );
  const good = validateWeeklySchedule([
    { dayOfWeek: 0, startTime: "08:00", endTime: "16:00", breaks: [{ start: "12:00", end: "12:45" }] },
    { dayOfWeek: 3, startTime: "09:00", endTime: "17:00" },
  ]);
  assert.ok(good.ok);
  assert.equal(good.ok && good.entries.length, 2);
  assert.deepEqual(good.ok && good.entries[0]!.breaks, [{ start: "12:00", end: "12:45" }]);
});

test("decideEmployeeBooking returns the specific rejection for each rule", () => {
  const base = {
    timeZone: TZ,
    schedule: WEDNESDAY_SCHEDULE,
    vacations: [] as Array<{ startDate: string; endDate: string }>,
    existingBookings: [] as Array<{ id: string; start: Date; end: Date }>,
  };
  assert.deepEqual(decideEmployeeBooking({ ...base, interval: interval(9, 60) }), { ok: true });
  assert.equal(
    decideEmployeeBooking({ ...base, interval: interval(7, 60) }).ok ? "" : (decideEmployeeBooking({ ...base, interval: interval(7, 60) }) as { code: string }).code,
    "outside_working_hours"
  );
  const vacationDecision = decideEmployeeBooking({
    ...base,
    interval: interval(9, 60),
    vacations: [{ startDate: "2026-07-15", endDate: "2026-07-15" }],
  });
  assert.equal(!vacationDecision.ok && vacationDecision.code, "on_vacation");
  const conflictDecision = decideEmployeeBooking({
    ...base,
    interval: interval(9, 60),
    existingBookings: [{ id: "b1", start: wednesdayLocal(9, 30), end: wednesdayLocal(10, 30) }],
  });
  assert.equal(!conflictDecision.ok && conflictDecision.code, "time_conflict");
  const excluded = decideEmployeeBooking({
    ...base,
    interval: interval(9, 60),
    existingBookings: [{ id: "b1", start: wednesdayLocal(9, 30), end: wednesdayLocal(10, 30) }],
    excludeBookingId: "b1",
  });
  assert.deepEqual(excluded, { ok: true });
});
