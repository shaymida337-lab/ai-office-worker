import {
  addCalendarDays,
  getLocalDateParts,
  getLocalTimeParts,
  wallClockToDate,
} from "./datetime.js";
import type {
  BusyBlock,
  CalendarRules,
  EngineAvailabilityResult,
  SlotCandidate,
  TimeInterval,
} from "./types.js";

export function appointmentEnd(start: Date, durationMinutes: number): Date {
  return new Date(start.getTime() + durationMinutes * 60_000);
}

export function intervalsOverlap(a: TimeInterval, b: TimeInterval, allowBackToBack = true): boolean {
  if (allowBackToBack) {
    return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
  }
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

export function isInPast(start: Date, now: Date = new Date()): boolean {
  return start.getTime() < now.getTime();
}

export function isWithinWorkingHours(interval: TimeInterval, rules: CalendarRules): boolean {
  const startLocal = getLocalTimeParts(interval.start, rules.timeZone);
  const endLocal = getLocalTimeParts(interval.end, rules.timeZone);

  if (
    startLocal.year !== endLocal.year ||
    startLocal.month !== endLocal.month ||
    startLocal.day !== endLocal.day
  ) {
    return false;
  }

  const startMinutes = startLocal.hour * 60 + startLocal.minute;
  const endMinutes = endLocal.hour * 60 + endLocal.minute;
  const workStart = rules.workingStartHour * 60;
  const workEnd = rules.workingEndHour * 60;

  return startMinutes >= workStart && endMinutes <= workEnd;
}

export function checkConflict(
  candidate: TimeInterval,
  busyBlocks: BusyBlock[],
  options?: { excludeId?: string; allowBackToBack?: boolean }
): EngineAvailabilityResult {
  const allowBackToBack = options?.allowBackToBack ?? true;

  for (const block of busyBlocks) {
    if (options?.excludeId && block.id === options.excludeId) continue;
    if (intervalsOverlap(candidate, block, allowBackToBack)) {
      return {
        available: false,
        reason: "time_conflict",
        conflict: block,
      };
    }
  }

  return { available: true };
}

export function generateSlotGrid(
  range: TimeInterval,
  durationMinutes: number,
  rules: CalendarRules,
  options?: { slotStepMinutes?: number; now?: Date }
): SlotCandidate[] {
  const slotStepMinutes = options?.slotStepMinutes ?? rules.slotStepMinutes;
  const slots: SlotCandidate[] = [];
  const dayKeys = listCalendarDaysInRange(range, rules.timeZone);

  for (const day of dayKeys) {
    const dayStartMinutes = rules.workingStartHour * 60;
    const dayEndMinutes = rules.workingEndHour * 60;
    const latestStartMinutes = dayEndMinutes - durationMinutes;

    for (let minute = dayStartMinutes; minute <= latestStartMinutes; minute += slotStepMinutes) {
      const hour = Math.floor(minute / 60);
      const min = minute % 60;
      const start = wallClockToDate(day.year, day.month, day.day, hour, min, rules.timeZone);
      if (!start) continue;

      const end = appointmentEnd(start, durationMinutes);
      if (start.getTime() < range.start.getTime() || start.getTime() >= range.end.getTime()) {
        continue;
      }

      slots.push({ start, end, durationMinutes });
    }
  }

  return slots;
}

export function findAvailableSlots(
  range: TimeInterval,
  durationMinutes: number,
  busyBlocks: BusyBlock[],
  rules: CalendarRules,
  options?: { limit?: number; slotStepMinutes?: number; now?: Date; excludeId?: string }
): SlotCandidate[] {
  const limit = options?.limit ?? 3;
  const now = options?.now ?? new Date();
  const grid = generateSlotGrid(range, durationMinutes, rules, {
    slotStepMinutes: options?.slotStepMinutes,
    now,
  });

  const available: SlotCandidate[] = [];

  for (const slot of grid) {
    if (isInPast(slot.start, now)) continue;
    if (!isWithinWorkingHours(slot, rules)) continue;

    const conflict = checkConflict(slot, busyBlocks, {
      excludeId: options?.excludeId,
      allowBackToBack: rules.allowBackToBack,
    });
    if (!conflict.available) continue;

    available.push(slot);
    if (available.length >= limit) break;
  }

  return available;
}

/** Find free slots within ±nearbyHours of a requested start, sorted by proximity. */
export function findAvailableSlotsNearTime(
  requestedStart: Date,
  searchRange: TimeInterval,
  durationMinutes: number,
  busyBlocks: BusyBlock[],
  rules: CalendarRules,
  options?: {
    nearbyHours?: number;
    limit?: number;
    slotStepMinutes?: number;
    now?: Date;
    excludeId?: string;
  }
): SlotCandidate[] {
  const nearbyHours = options?.nearbyHours ?? 3;
  const limit = options?.limit ?? 3;
  const now = options?.now ?? new Date();
  const windowStartMs = requestedStart.getTime() - nearbyHours * 60 * 60 * 1000;
  const windowEndMs = requestedStart.getTime() + nearbyHours * 60 * 60 * 1000;

  const grid = generateSlotGrid(searchRange, durationMinutes, rules, {
    slotStepMinutes: options?.slotStepMinutes,
    now,
  });

  const available: SlotCandidate[] = [];
  for (const slot of grid) {
    const startMs = slot.start.getTime();
    if (startMs < windowStartMs || startMs > windowEndMs) continue;
    if (isInPast(slot.start, now)) continue;
    if (!isWithinWorkingHours(slot, rules)) continue;

    const conflict = checkConflict(slot, busyBlocks, {
      excludeId: options?.excludeId,
      allowBackToBack: rules.allowBackToBack,
    });
    if (!conflict.available) continue;

    available.push(slot);
  }

  return pickNearbySlots(available, requestedStart, limit);
}

/** Pick closest slots, balancing before/after the requested time at each distance tier. */
function pickNearbySlots(
  candidates: SlotCandidate[],
  requestedStart: Date,
  limit: number
): SlotCandidate[] {
  if (candidates.length <= limit) return candidates;

  const requestedMs = requestedStart.getTime();
  const byDistance = new Map<number, SlotCandidate[]>();
  for (const slot of candidates) {
    const dist = Math.abs(slot.start.getTime() - requestedMs);
    const group = byDistance.get(dist);
    if (group) group.push(slot);
    else byDistance.set(dist, [slot]);
  }

  const distances = [...byDistance.keys()].sort((a, b) => a - b);
  const result: SlotCandidate[] = [];
  let hasBefore = false;
  let hasAfter = false;

  for (const dist of distances) {
    const group = byDistance.get(dist)!;
    const before = group
      .filter((s) => s.start.getTime() < requestedMs)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const after = group
      .filter((s) => s.start.getTime() >= requestedMs)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let bi = 0;
    let ai = 0;
    while (bi < before.length || ai < after.length) {
      let next: SlotCandidate | undefined;
      if (!hasBefore && bi < before.length) {
        next = before[bi++];
      } else if (!hasAfter && ai < after.length) {
        next = after[ai++];
      } else if (hasBefore && hasAfter) {
        if (ai < after.length) next = after[ai++];
        else if (bi < before.length) next = before[bi++];
      } else if (bi < before.length) {
        next = before[bi++];
      } else if (ai < after.length) {
        next = after[ai++];
      }

      if (!next) break;
      result.push(next);
      if (next.start.getTime() < requestedMs) hasBefore = true;
      else hasAfter = true;
      if (result.length >= limit) return result;
    }
  }

  return result;
}

type LocalDateParts = { year: number; month: number; day: number };

function listCalendarDaysInRange(range: TimeInterval, timeZone: string): LocalDateParts[] {
  const days: LocalDateParts[] = [];
  const seen = new Set<string>();

  let cursor = getLocalDateParts(range.start, timeZone);
  const endDay = getLocalDateParts(new Date(range.end.getTime() - 1), timeZone);

  while (true) {
    const key = `${cursor.year}-${cursor.month}-${cursor.day}`;
    if (!seen.has(key)) {
      seen.add(key);
      days.push({ ...cursor });
    }

    if (
      cursor.year === endDay.year &&
      cursor.month === endDay.month &&
      cursor.day === endDay.day
    ) {
      break;
    }

    cursor = addCalendarDays(cursor, 1);
    if (days.length > 366) break;
  }

  return days;
}
