import type { SuggestAvailableTimesProposal } from "../natalieAvailability.js";

export type AvailabilitySlotLike = SuggestAvailableTimesProposal["slots"][number];

export type SlotResolutionResult =
  | { kind: "resolved"; slot: AvailabilitySlotLike; confidence: "high" | "medium" }
  | { kind: "ambiguous"; candidates: AvailabilitySlotLike[]; message: string }
  | { kind: "none" };

const HOUR_WORD_TO_NUMBER: Record<string, number> = {
  אחת: 1,
  שתיים: 2,
  שניים: 2,
  שלוש: 3,
  ארבע: 4,
  חמש: 5,
  שש: 6,
  שבע: 7,
  שמונה: 8,
  תשע: 9,
  עשר: 10,
  "אחת עשרה": 11,
  "אחת-עשרה": 11,
  "שתים עשרה": 12,
  "שתיים עשרה": 12,
  "שתים-עשרה": 12,
  "שתיים-עשרה": 12,
};

const ORDINAL_PATTERNS: Array<{ pattern: RegExp; resolve: (slots: AvailabilitySlotLike[]) => number | null }> = [
  { pattern: /(?:^|\s)(?:ה)?ראשון(?:ה)?(?:\s|$)/u, resolve: () => 0 },
  { pattern: /(?:^|\s)(?:ה)?שני(?:ה)?(?:\s|$)/u, resolve: () => 1 },
  { pattern: /(?:^|\s)(?:ה)?שלישי(?:ת)?(?:\s|$)/u, resolve: () => 2 },
  { pattern: /(?:^|\s)(?:ה)?רביעי(?:ת)?(?:\s|$)/u, resolve: () => 3 },
  { pattern: /(?:^|\s)(?:ה)?אחרון(?:ה)?(?:\s|$)/u, resolve: (slots) => slots.length - 1 },
  { pattern: /(?:^|\s)(?:ה)?מאוחר(?:ה)?(?:\s|$)|(?:^|\s)הכי\s+מאוחר(?:\s|$)/u, resolve: (slots) => slots.length - 1 },
  { pattern: /(?:^|\s)(?:ה)?מוקדם(?:ה)?(?:\s|$)|(?:^|\s)הכי\s+מוקדם(?:\s|$)/u, resolve: () => 0 },
];

function normalizeUtterance(utterance: string): string {
  return utterance
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[בל]\s*[-–]?\s*/u, "")
    .replace(/^בשעה\s+/u, "")
    .toLowerCase();
}

function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/** Candidate clock times for a spoken hour against a finite offered slot list. */
function candidateMinuteValues(hour: number, minute: number): number[] {
  const values = new Set<number>();
  values.add(toMinutes(hour, minute));
  if (hour >= 1 && hour <= 11) {
    values.add(toMinutes(hour + 12, minute));
  }
  if (hour >= 13 && hour <= 23) {
    values.add(toMinutes(hour - 12, minute));
  }
  return [...values];
}

export function slotTimeMinutes(slot: AvailabilitySlotLike): number {
  const fromLabel = slot.label.match(/(\d{1,2}):(\d{2})/u);
  if (fromLabel) {
    return toMinutes(Number(fromLabel[1]), Number(fromLabel[2]));
  }
  const date = new Date(slot.startTime);
  if (!Number.isNaN(date.getTime())) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return toMinutes(hour, minute);
  }
  return -1;
}

function parseExplicitTime(utterance: string): { hour: number; minute: number } | null {
  const colonMatch = utterance.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/u);
  if (colonMatch) {
    const hour = Number(colonMatch[1]);
    const minute = Number(colonMatch[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const ofHourMatch = utterance.match(/של\s+(?<word>ארבע|חמש|שש|שבע|שמונה|תשע|עשר|אחת|שתיים|שניים|שלוש|\d{1,2})/u);
  if (ofHourMatch?.groups?.word) {
    const parsed = parseHebrewHourPhrase(ofHourMatch.groups.word, utterance.includes("וחצי"));
    if (parsed) return parsed;
  }

  const halfMatch = utterance.match(
    /(?<hour>שתים\s+עשרה|שתיים\s+עשרה|אחת\s+עשרה|עשר|תשע|שמונה|שבע|שש|חמש|ארבע|שלוש|שתיים|שניים|אחת|\d{1,2})\s+וחצי/u
  );
  if (halfMatch?.groups?.hour) {
    const parsed = parseHebrewHourPhrase(halfMatch.groups.hour, true);
    if (parsed) return parsed;
  }

  const hourOnlyMatch = utterance.match(
    /(?:^|\s)(?<hour>שתים\s+עשרה|שתיים\s+עשרה|אחת\s+עשרה|עשר|תשע|שמונה|שבע|שש|חמש|ארבע|שלוש|שתיים|שניים|אחת|\d{1,2})(?:\s|$)/u
  );
  if (hourOnlyMatch?.groups?.hour) {
    const parsed = parseHebrewHourPhrase(hourOnlyMatch.groups.hour, false);
    if (parsed) return parsed;
  }

  return null;
}

function parseHebrewHourPhrase(token: string, withHalf: boolean): { hour: number; minute: number } | null {
  const normalized = token.trim().toLowerCase();
  const mapped = HOUR_WORD_TO_NUMBER[normalized];
  if (mapped !== undefined) {
    return { hour: mapped, minute: withHalf ? 30 : 0 };
  }
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 23) {
    return { hour: numeric, minute: withHalf ? 30 : 0 };
  }
  return null;
}

function resolveOrdinal(utterance: string, slots: AvailabilitySlotLike[]): AvailabilitySlotLike | null {
  for (const { pattern, resolve } of ORDINAL_PATTERNS) {
    if (!pattern.test(utterance)) continue;
    const index = resolve(slots);
    if (index === null || index < 0 || index >= slots.length) continue;
    return slots[index]!;
  }
  return null;
}

function filterByDayPart(
  slots: AvailabilitySlotLike[],
  utterance: string
): AvailabilitySlotLike[] | null {
  if (/(?:^|\s)אחר\s+הצהריים(?:\s|$)/u.test(utterance)) {
    const afternoon = slots.filter((slot) => slotTimeMinutes(slot) >= 12 * 60);
    return afternoon.length > 0 ? afternoon : null;
  }
  if (/(?:^|\s)בבוקר(?:\s|$)/u.test(utterance)) {
    const morning = slots.filter((slot) => slotTimeMinutes(slot) < 12 * 60);
    return morning.length > 0 ? morning : null;
  }
  return null;
}

function slotsMatchingTime(
  slots: AvailabilitySlotLike[],
  hour: number,
  minute: number
): AvailabilitySlotLike[] {
  const candidates = new Set(candidateMinuteValues(hour, minute));
  return slots.filter((slot) => candidates.has(slotTimeMinutes(slot)));
}

function looksLikeSlotSelectionAttempt(utterance: string): boolean {
  if (ORDINAL_PATTERNS.some(({ pattern }) => pattern.test(utterance))) return true;
  if (/(?:^|\s)אחר\s+הצהריים(?:\s|$)|(?:^|\s)בבוקר(?:\s|$)/u.test(utterance)) return true;
  if (/\d{1,2}:\d{2}/u.test(utterance)) return true;
  if (/של\s+(?:ארבע|חמש|שש|שבע|שמונה|תשע|עשר)/u.test(utterance)) return true;
  if (
    /(?:^|\s)(?:שתים\s+עשרה|שתיים\s+עשרה|אחת\s+עשרה|עשר|תשע|שמונה|שבע|שש|חמש|ארבע|שלוש|שתיים|שניים|אחת)(?:\s|$)/u.test(
      utterance
    )
  ) {
    return true;
  }
  return false;
}

function formatAmbiguousSlotMessage(candidates: AvailabilitySlotLike[]): string {
  const labels = candidates.map((slot) => slot.label).join(", ");
  return `יש כמה אפשרויות שמתאימות: ${labels}. איזה מהם?`;
}

export function resolveAvailabilitySlotFromUtterance(
  utterance: string,
  slots: AvailabilitySlotLike[]
): SlotResolutionResult {
  if (!slots.length) return { kind: "none" };

  const normalized = normalizeUtterance(utterance);
  if (!normalized) return { kind: "none" };

  const ordinalSlot = resolveOrdinal(normalized, slots);
  if (ordinalSlot) {
    return { kind: "resolved", slot: ordinalSlot, confidence: "high" };
  }

  const dayPartFiltered = filterByDayPart(slots, normalized);
  if (dayPartFiltered) {
    if (dayPartFiltered.length === 1) {
      return { kind: "resolved", slot: dayPartFiltered[0]!, confidence: "medium" };
    }
    const explicitInSubset = parseExplicitTime(normalized);
    if (explicitInSubset) {
      const matches = slotsMatchingTime(dayPartFiltered, explicitInSubset.hour, explicitInSubset.minute);
      if (matches.length === 1) {
        return { kind: "resolved", slot: matches[0]!, confidence: "high" };
      }
      if (matches.length > 1) {
        return {
          kind: "ambiguous",
          candidates: matches,
          message: formatAmbiguousSlotMessage(matches),
        };
      }
    }
    if (/(?:^|\s)(?:ה)?מאוחר/u.test(normalized)) {
      return { kind: "resolved", slot: dayPartFiltered[dayPartFiltered.length - 1]!, confidence: "medium" };
    }
    if (/(?:^|\s)(?:ה)?מוקדם/u.test(normalized)) {
      return { kind: "resolved", slot: dayPartFiltered[0]!, confidence: "medium" };
    }
    return {
      kind: "ambiguous",
      candidates: dayPartFiltered,
      message: formatAmbiguousSlotMessage(dayPartFiltered),
    };
  }

  const explicit = parseExplicitTime(normalized);
  if (explicit) {
    const matches = slotsMatchingTime(slots, explicit.hour, explicit.minute);
    if (matches.length === 1) {
      return { kind: "resolved", slot: matches[0]!, confidence: "high" };
    }
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        candidates: matches,
        message: formatAmbiguousSlotMessage(matches),
      };
    }
  }

  if (looksLikeSlotSelectionAttempt(normalized)) {
    return {
      kind: "ambiguous",
      candidates: slots,
      message: `לא מצאתי את השעה הזו בין האפשרויות. אפשר לבחור מתוך: ${slots.map((s) => s.label).join(", ")}.`,
    };
  }

  return { kind: "none" };
}

export function parseSlotLabelParts(label: string): { dayLabel: string; timeLabel: string } {
  const timeMatch = label.match(/(\d{1,2}:\d{2})/u);
  const timeLabel = timeMatch?.[1] ?? "";
  const dayLabel = label.replace(timeLabel, "").trim();
  return { dayLabel, timeLabel };
}
