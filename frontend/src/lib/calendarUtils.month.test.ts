import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMonthGrid,
  computeFreeMinutesToday,
  findSchedulingConflicts,
  getMonthBounds,
  sliceMonthDayAppointments,
  toDateInputValue,
} from "./calendarUtils";

test("buildMonthGrid returns 42 days starting on week start", () => {
  const grid = buildMonthGrid(new Date("2026-07-15T12:00:00"));
  assert.equal(grid.length, 42);
  assert.equal(grid[0]!.getDay(), 0);
});

test("getMonthBounds covers full calendar month", () => {
  const bounds = getMonthBounds(new Date("2026-07-15T12:00:00"));
  assert.equal(bounds.from.getDate(), 1);
  assert.equal(bounds.from.getMonth(), 6);
  assert.equal(bounds.to.getMonth(), 7);
});

test("sliceMonthDayAppointments limits visible items", () => {
  const items = ["a", "b", "c", "d"];
  const sliced = sliceMonthDayAppointments(items, 2);
  assert.deepEqual(sliced.visible, ["a", "b"]);
  assert.equal(sliced.overflowCount, 2);
});

test("findSchedulingConflicts detects overlapping appointments", () => {
  const dayKey = toDateInputValue(new Date("2026-07-06T12:00:00"));
  const conflicts = findSchedulingConflicts(
    [
      {
        id: "1",
        startTime: "2026-07-06T10:00:00",
        durationMinutes: 60,
        status: "confirmed",
        client: { name: "א" },
      },
      {
        id: "2",
        startTime: "2026-07-06T10:30:00",
        durationMinutes: 60,
        status: "confirmed",
        client: { name: "ב" },
      },
    ],
    dayKey
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.clientA, "א");
});

test("computeFreeMinutesToday subtracts busy blocks from workday", () => {
  const dayKey = toDateInputValue(new Date("2026-07-06T12:00:00"));
  const free = computeFreeMinutesToday(
    [
      {
        id: "1",
        startTime: "2026-07-06T09:00:00",
        durationMinutes: 60,
        status: "confirmed",
        client: { name: "א" },
      },
    ],
    dayKey,
    8,
    18
  );
  assert.equal(free, 9 * 60);
});
