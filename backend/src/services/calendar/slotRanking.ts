import { getLocalTimeParts } from "./datetime.js";
import type { CalendarRules, SlotCandidate } from "./types.js";

export type SlotTimeConstraint =
  | { kind: "morning" }
  | { kind: "noon" }
  | { kind: "afternoon" }
  | { kind: "evening" }
  | { kind: "after"; hour: number; minute?: number }
  | { kind: "before"; hour: number; minute?: number };

export type SlotRankingMode = "default" | "best_available";

export type SlotRankingOptions = {
  mode?: SlotRankingMode;
  constraints?: SlotTimeConstraint[];
  timeZone: string;
  workingStartHour: number;
  workingEndHour: number;
};

const PREFERRED_START_MINUTES = 9 * 60;
const PREFERRED_END_MINUTES = 17 * 60;
const SWEET_SPOT_MINUTES = 10 * 60 + 30;

export function isBestAvailablePhrase(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  return /(?:בזמן\s+הכי\s+טוב|מתי\s+הכי\s+כדאי|הכי\s+כדאי|תמצ(?:א|י)(?:י)?\s+(?:לי\s+)?שעה\s+טובה)/u.test(
    normalized
  );
}

export function parseSlotTimeConstraints(text: string): SlotTimeConstraint[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  const constraints: SlotTimeConstraint[] = [];

  if (/(?:^|\s)בבוקר(?:\s|$|[?.!,])/u.test(normalized)) {
    constraints.push({ kind: "morning" });
  }
  if (/(?:^|\s)בצהריים(?:\s|$|[?.!,])/u.test(normalized)) {
    constraints.push({ kind: "noon" });
  }
  if (/אחר(?:י)?\s+הצהריים/u.test(normalized)) {
    constraints.push({ kind: "afternoon" });
  }
  if (/(?:^|\s)בערב(?:\s|$|[?.!,])/u.test(normalized)) {
    constraints.push({ kind: "evening" });
  }
  if (/אחרי\s+16(?::00)?/u.test(normalized)) {
    constraints.push({ kind: "after", hour: 16, minute: 0 });
  }
  if (/לפני\s+12(?::00)?/u.test(normalized)) {
    constraints.push({ kind: "before", hour: 12, minute: 0 });
  }

  return constraints;
}

function localStartMinutes(slot: SlotCandidate, timeZone: string): number {
  const local = getLocalTimeParts(slot.start, timeZone);
  return local.hour * 60 + local.minute;
}

function localDateKey(slot: SlotCandidate, timeZone: string): string {
  const local = getLocalTimeParts(slot.start, timeZone);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

export function slotMatchesConstraints(
  slot: SlotCandidate,
  constraints: SlotTimeConstraint[],
  timeZone: string,
  rules: Pick<CalendarRules, "workingStartHour" | "workingEndHour">
): boolean {
  if (constraints.length === 0) return true;

  const startMinutes = localStartMinutes(slot, timeZone);
  const workStart = rules.workingStartHour * 60;
  const workEnd = rules.workingEndHour * 60;
  if (startMinutes < workStart || startMinutes >= workEnd) return false;

  return constraints.every((constraint) => {
    switch (constraint.kind) {
      case "morning":
        return startMinutes >= workStart && startMinutes < 12 * 60;
      case "noon":
        return startMinutes >= 11 * 60 && startMinutes < 14 * 60;
      case "afternoon":
        return startMinutes >= 12 * 60 && startMinutes < 17 * 60;
      case "evening":
        return startMinutes >= 17 * 60 && startMinutes < workEnd;
      case "after": {
        const threshold = constraint.hour * 60 + (constraint.minute ?? 0);
        return startMinutes >= threshold;
      }
      case "before": {
        const threshold = constraint.hour * 60 + (constraint.minute ?? 0);
        return startMinutes < threshold;
      }
      default:
        return true;
    }
  });
}

export function scoreSlotForRanking(
  slot: SlotCandidate,
  options: SlotRankingOptions
): number {
  const startMinutes = localStartMinutes(slot, options.timeZone);
  const workStart = options.workingStartHour * 60;
  const workEnd = options.workingEndHour * 60;

  if (startMinutes < workStart || startMinutes >= workEnd) {
    return Number.NEGATIVE_INFINITY;
  }

  if (startMinutes >= PREFERRED_START_MINUTES && startMinutes <= PREFERRED_END_MINUTES) {
    return 10_000 - Math.abs(startMinutes - SWEET_SPOT_MINUTES);
  }

  if (startMinutes < PREFERRED_START_MINUTES) {
    return 1_000 - (PREFERRED_START_MINUTES - startMinutes) * 3;
  }

  return 5_000 - (startMinutes - PREFERRED_END_MINUTES) * 2;
}

export function rankAvailableSlots(
  slots: SlotCandidate[],
  options: SlotRankingOptions,
  limit: number
): SlotCandidate[] {
  const constraints = options.constraints ?? [];
  const filtered = slots.filter((slot) => {
    if (!slotMatchesConstraints(slot, constraints, options.timeZone, options)) return false;
    return scoreSlotForRanking(slot, options) !== Number.NEGATIVE_INFINITY;
  });

  const ranked = [...filtered].sort((a, b) => {
    const dayCompare = localDateKey(a, options.timeZone).localeCompare(
      localDateKey(b, options.timeZone)
    );
    if (dayCompare !== 0) return dayCompare;

    const scoreDiff = scoreSlotForRanking(b, options) - scoreSlotForRanking(a, options);
    if (scoreDiff !== 0) return scoreDiff;

    return a.start.getTime() - b.start.getTime();
  });

  return ranked.slice(0, limit);
}

export function buildSlotRankingOptions(
  rules: CalendarRules,
  params?: { mode?: SlotRankingMode; constraints?: SlotTimeConstraint[] }
): SlotRankingOptions {
  return {
    mode: params?.mode ?? "default",
    constraints: params?.constraints,
    timeZone: rules.timeZone,
    workingStartHour: rules.workingStartHour,
    workingEndHour: rules.workingEndHour,
  };
}

export function slotLocalTimeString(slot: SlotCandidate, timeZone: string): string {
  const local = getLocalTimeParts(slot.start, timeZone);
  return `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
}
