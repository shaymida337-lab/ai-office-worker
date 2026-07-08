import test from "node:test";
import assert from "node:assert/strict";

import {
  appointmentEnd,
  checkConflict,
  findAvailableSlots,
  findAvailableSlotsNearTime,
  generateSlotGrid,
  intervalsOverlap,
  isInPast,
  isWithinWorkingHours,
} from "./engine.js";
import type { BusyBlock, CalendarRules } from "./types.js";

const RULES: CalendarRules = {
  timeZone: "UTC",
  workingStartHour: 7,
  workingEndHour: 21,
  defaultDurationMinutes: 30,
  slotStepMinutes: 30,
  allowBackToBack: true,
};

function at(iso: string) {
  return new Date(iso);
}

function block(id: string, startIso: string, durationMinutes: number): BusyBlock {
  const start = at(startIso);
  return {
    id,
    source: "appointment",
    start,
    end: appointmentEnd(start, durationMinutes),
    durationMinutes,
  };
}

test("intervalsOverlap detects overlapping intervals", () => {
  const a = { start: at("2026-06-20T10:00:00.000Z"), end: at("2026-06-20T11:00:00.000Z") };
  const b = { start: at("2026-06-20T10:30:00.000Z"), end: at("2026-06-20T11:30:00.000Z") };
  assert.equal(intervalsOverlap(a, b), true);
});

test("intervalsOverlap allows non-overlapping intervals", () => {
  const a = { start: at("2026-06-20T10:00:00.000Z"), end: at("2026-06-20T11:00:00.000Z") };
  const b = { start: at("2026-06-20T11:30:00.000Z"), end: at("2026-06-20T12:30:00.000Z") };
  assert.equal(intervalsOverlap(a, b), false);
});

test("intervalsOverlap allows back-to-back intervals", () => {
  const a = { start: at("2026-06-20T10:00:00.000Z"), end: at("2026-06-20T11:00:00.000Z") };
  const b = { start: at("2026-06-20T11:00:00.000Z"), end: at("2026-06-20T12:00:00.000Z") };
  assert.equal(intervalsOverlap(a, b), false);
});

test("checkConflict returns unavailable when overlapping busy block exists", () => {
  const candidate = { start: at("2026-06-20T10:30:00.000Z"), end: at("2026-06-20T11:30:00.000Z") };
  const result = checkConflict(candidate, [block("a1", "2026-06-20T10:00:00.000Z", 60)]);
  assert.equal(result.available, false);
  assert.equal(result.reason, "time_conflict");
  assert.equal(result.conflict?.id, "a1");
});

test("checkConflict ignores excluded appointment id", () => {
  const candidate = { start: at("2026-06-20T10:00:00.000Z"), end: at("2026-06-20T11:00:00.000Z") };
  const result = checkConflict(candidate, [block("a1", "2026-06-20T10:00:00.000Z", 60)], {
    excludeId: "a1",
  });
  assert.equal(result.available, true);
});

test("isWithinWorkingHours accepts slot inside working hours", () => {
  const interval = { start: at("2026-06-20T10:00:00.000Z"), end: at("2026-06-20T10:30:00.000Z") };
  assert.equal(isWithinWorkingHours(interval, RULES), true);
});

test("isWithinWorkingHours rejects slot outside working hours", () => {
  const interval = { start: at("2026-06-20T06:30:00.000Z"), end: at("2026-06-20T07:00:00.000Z") };
  assert.equal(isWithinWorkingHours(interval, RULES), false);
});

test("isWithinWorkingHours rejects slot ending after working hours", () => {
  const interval = { start: at("2026-06-20T20:45:00.000Z"), end: at("2026-06-20T21:15:00.000Z") };
  assert.equal(isWithinWorkingHours(interval, RULES), false);
});

test("isInPast detects past start times", () => {
  const now = at("2026-06-20T12:00:00.000Z");
  assert.equal(isInPast(at("2026-06-20T11:00:00.000Z"), now), true);
  assert.equal(isInPast(at("2026-06-20T12:00:00.000Z"), now), false);
});

test("generateSlotGrid creates slots inside working hours", () => {
  const range = {
    start: at("2026-06-20T00:00:00.000Z"),
    end: at("2026-06-21T00:00:00.000Z"),
  };
  const slots = generateSlotGrid(range, 30, RULES);
  assert.ok(slots.length > 0);
  assert.equal(slots[0]?.start.toISOString(), "2026-06-20T07:00:00.000Z");
  assert.ok(slots.every((slot) => isWithinWorkingHours(slot, RULES)));
});

test("findAvailableSlots returns top ranked available slots", () => {
  const range = {
    start: at("2026-06-20T00:00:00.000Z"),
    end: at("2026-06-21T00:00:00.000Z"),
  };
  const busy = [block("busy", "2026-06-20T07:00:00.000Z", 30)];
  const slots = findAvailableSlots(range, 30, busy, RULES, {
    limit: 3,
    now: at("2026-06-20T00:00:00.000Z"),
  });
  assert.equal(slots.length, 3);
  assert.equal(slots[0]?.start.toISOString(), "2026-06-20T10:30:00.000Z");
  assert.notEqual(slots[0]?.start.toISOString(), "2026-06-20T07:30:00.000Z");
});

test("findAvailableSlots returns empty for fully busy day", () => {
  const range = {
    start: at("2026-06-20T00:00:00.000Z"),
    end: at("2026-06-21T00:00:00.000Z"),
  };
  const busy: BusyBlock[] = [];
  for (let hour = 7; hour < 21; hour++) {
    for (const minute of [0, 30]) {
      busy.push(block(`b-${hour}-${minute}`, `2026-06-20T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`, 30));
    }
  }
  const slots = findAvailableSlots(range, 30, busy, RULES, {
    limit: 3,
    now: at("2026-06-20T00:00:00.000Z"),
  });
  assert.equal(slots.length, 0);
});

test("findAvailableSlots skips past slots", () => {
  const range = {
    start: at("2026-06-20T00:00:00.000Z"),
    end: at("2026-06-21T00:00:00.000Z"),
  };
  const slots = findAvailableSlots(range, 30, [], RULES, {
    limit: 1,
    now: at("2026-06-20T12:00:00.000Z"),
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0]?.start.toISOString(), "2026-06-20T12:00:00.000Z");
});

test("findAvailableSlots returns slots on later free days when earlier days are busy", () => {
  const range = {
    start: at("2026-06-20T00:00:00.000Z"),
    end: at("2026-06-23T00:00:00.000Z"),
  };
  const busy = [
    block("day1", "2026-06-20T07:00:00.000Z", 14 * 60),
    block("day2", "2026-06-21T07:00:00.000Z", 14 * 60),
  ];
  const slots = findAvailableSlots(range, 30, busy, RULES, {
    limit: 3,
    now: at("2026-06-20T00:00:00.000Z"),
  });
  assert.equal(slots.length, 3);
  assert.equal(slots[0]?.start.toISOString().slice(0, 10), "2026-06-22");
});

test("findAvailableSlotsNearTime balances before and after requested time", () => {
  const range = {
    start: at("2026-06-21T00:00:00.000Z"),
    end: at("2026-06-22T00:00:00.000Z"),
  };
  const busy = [block("busy", "2026-06-21T10:00:00.000Z", 30)];
  const requested = at("2026-06-21T10:00:00.000Z");
  const slots = findAvailableSlotsNearTime(requested, range, 30, busy, RULES, {
    limit: 3,
    now: at("2026-06-20T08:00:00.000Z"),
  });
  assert.deepEqual(
    slots.map((slot) => slot.start.toISOString()),
    [
      "2026-06-21T09:30:00.000Z",
      "2026-06-21T10:30:00.000Z",
      "2026-06-21T11:00:00.000Z",
    ]
  );
});
