import type { NatalieClaudeResponse } from "./claude.js";
import {
  checkSlotAvailability,
  findAvailableSlotsForOrganization,
} from "./calendar/availability.js";
import type { FindAvailableSlotsResult, SuggestedSlot } from "./calendar/types.js";

export type AvailabilityIntentKind = "none" | "check" | "suggest";

export type AvailabilityIntent = {
  kind: AvailabilityIntentKind;
  dayReference?: string;
  time?: string;
  rangeType: "day" | "week";
  limit: number;
  durationMinutes?: number;
  clientName?: string;
  firstOnly?: boolean;
};

export type SuggestAvailableTimesProposal = {
  slots: Array<{
    startTime: string;
    endTime: string;
    label: string;
    durationMinutes: number;
  }>;
  durationMinutes: number;
  rangeType?: "day" | "week";
  dayReference?: string;
  clientName?: string;
  intent: "suggest" | "first_available" | "check_alternatives";
  refreshParams: {
    rangeType?: "day" | "week";
    dayReference?: string;
    durationMinutes?: number;
    limit?: number;
  };
};

const HEBREW_WEEKDAY_PATTERN =
  /(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/u;

function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ");
}

function toTimeString(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Colloquial Hebrew hour without AM/PM → afternoon within typical business hours (3→15:00). */
function applyBusinessHoursHour(hour: number): number {
  if (hour >= 13) return hour;
  if (hour === 12) return 12;
  if (hour >= 1 && hour <= 11) return hour + 12;
  return hour;
}

function normalizeTimeToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.includes(":")) {
    const [hourPart, minutePart = "00"] = trimmed.split(":");
    const hour = Number(hourPart);
    const minute = Number(minutePart);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return trimmed;
    if (hourPart.length >= 2 && hourPart.startsWith("0")) {
      return toTimeString(hour, minute);
    }
    if (hour >= 13) {
      return toTimeString(hour, minute);
    }
    if (hourPart.length === 1 && hour >= 1 && hour <= 9) {
      return toTimeString(applyBusinessHoursHour(hour), minute);
    }
    return toTimeString(hour, minute);
  }
  const hour = Number(trimmed);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return trimmed;
  if (hour >= 13) return toTimeString(hour);
  if (trimmed.length === 1 && hour >= 1 && hour <= 9) {
    return toTimeString(applyBusinessHoursHour(hour));
  }
  return toTimeString(hour);
}

function parseLimit(normalized: string): number | undefined {
  if (/(?:שלוש|שלושה)\s+זמנים?/u.test(normalized)) return 3;
  if (/(?:שתי|שני)\s+זמנים?/u.test(normalized)) return 2;
  const match = normalized.match(/(\d+)\s+זמנים?/u);
  if (match) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

function parseDurationMinutes(normalized: string): number | undefined {
  if (/(?:שעה|שעה\s+פנויה)/u.test(normalized) && !/שעות/u.test(normalized)) return 60;
  const match = normalized.match(/(\d+)\s+דק(?:ות)?/u);
  if (match) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

function extractDayReference(normalized: string): string | undefined {
  if (/(?:^|\s)היום(?:\s|$|[?.!,])/u.test(normalized)) return "היום";
  if (/(?:^|\s)מחרתיים(?:\s|$|[?.!,])/u.test(normalized)) return "מחרתיים";
  if (/(?:^|\s)מחר(?:\s|$|[?.!,])/u.test(normalized)) return "מחר";
  if (/(?:^|\s)השבוע(?:\s|$|[?.!,])/u.test(normalized)) return undefined;

  const weekdayMatch = normalized.match(HEBREW_WEEKDAY_PATTERN);
  if (weekdayMatch) {
    const token = weekdayMatch[0];
    return token.startsWith("יום") ? token : `יום ${token}`;
  }

  const dateMatch = normalized.match(/(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/u);
  if (dateMatch) return dateMatch[1];

  return undefined;
}

function parseHebrewHourToken(token: string): string | null {
  const map: Record<string, number> = {
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
    "11": 11,
    "12": 12,
  };
  const normalized = token.trim().toLowerCase();
  if (map[normalized] !== undefined) {
    return toTimeString(applyBusinessHoursHour(map[normalized]));
  }
  return null;
}

function extractCheckTime(normalized: string): { dayReference?: string; time: string } | null {
  const hebrewHourMatch = normalized.match(
    /(?:פנוי|יש\s+מקום)\s*(?<day>היום|מחר|מחרתיים|יום\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת))?\s*(?:בשעה\s+)?ב[-\s]?(?<timeWord>שלוש|שתיים|שניים|ארבע|חמש|שש|שבע|שמונה|תשע|עשר|אחת|\d{1,2}(?::\d{2})?)/u
  );
  if (hebrewHourMatch?.groups?.timeWord) {
    const parsedHebrew = parseHebrewHourToken(hebrewHourMatch.groups.timeWord);
    const time = parsedHebrew ?? normalizeTimeToken(hebrewHourMatch.groups.timeWord);
    const dayReference =
      hebrewHourMatch.groups.day?.trim() ||
      extractDayReference(normalized) ||
      (/מחר/u.test(normalized) ? "מחר" : /היום/u.test(normalized) ? "היום" : undefined);
    return { dayReference, time };
  }

  const patterns: Array<{ regex: RegExp; dayGroup?: number; timeGroup: number }> = [
    {
      regex:
        /(?:פנוי|יש\s+מקום)\s+(?<day>היום|מחר|מחרתיים|יום\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת))\s*(?:בשעה\s+)?ב[-\s]?(?<time>\d{1,2}(?::\d{2})?)/u,
      dayGroup: 1,
      timeGroup: 2,
    },
    {
      regex: /(?:פנוי|יש\s+מקום)\s+(?:בשעה\s+)?ב[-\s]?(?<time>\d{1,2}(?::\d{2})?)/u,
      timeGroup: 1,
    },
    {
      regex: /(?:פנוי|יש\s+מקום)\s+(?:בשעה\s+)?(?<time>\d{1,2}(?::\d{2})?)/u,
      timeGroup: 1,
    },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (!match?.groups?.time) continue;
    const dayReference =
      match.groups.day?.trim() ||
      extractDayReference(normalized) ||
      (/מחר/u.test(normalized) ? "מחר" : /היום/u.test(normalized) ? "היום" : undefined);
    return {
      dayReference,
      time: normalizeTimeToken(match.groups.time),
    };
  }

  return null;
}

export function isAppointmentWriteIntent(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (/(?:בטל|בטלי|ביטול)\s+(?:את\s+)?(?:ה)?תור/u.test(normalized)) return true;
  if (/(?:תעביר|תעבירי|תשני|תשנה|שנה\s+מועד)\s+(?:את\s+)?(?:ה)?תור/u.test(normalized)) return true;
  if (
    /(?:קבע|תקבע|תרשמ|רשמ|תזמין).{0,24}(?:תור|פגישה)/u.test(normalized) &&
    !/(?:פנוי|מקום\s+פנוי|הזמן\s+הראשון|הראשון\s+פנוי|זמן\s+פנוי)/u.test(normalized)
  ) {
    return true;
  }
  return false;
}

export function isAvailabilityQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (isAppointmentWriteIntent(normalized)) return false;

  const signals = [
    /מתי\s+(?:אני\s+)?פנוי/u,
    /מתי\s+יש\s+(?:לי\s+)?זמן/u,
    /יש\s+(?:לי\s+)?זמן/u,
    /מה\s+פנוי/u,
    /יש\s+מקום/u,
    /(?:^|\s)פנוי\s+ב/u,
    /פנוי\s+מחר/u,
    /תמצא(?:י)?\s+(?:לי\s+)?שעה/u,
    /תציע(?:י)?/u,
    /זמנים?\s+פנויים?/u,
    /הזמן\s+הראשון\s+הפנוי/u,
    /הראשון\s+הפנוי/u,
    /שעה\s+פנויה/u,
  ];

  return signals.some((pattern) => pattern.test(normalized));
}

export function parseAvailabilityIntent(question: string): AvailabilityIntent {
  const normalized = normalizeQuestion(question);
  if (!isAvailabilityQuestion(normalized)) {
    return { kind: "none", rangeType: "week", limit: 3 };
  }

  const durationMinutes = parseDurationMinutes(normalized);
  const parsedLimit = parseLimit(normalized);
  const firstOnly =
    /(?:הזמן\s+הראשון\s+הפנוי|הראשון\s+הפנוי|זמן\s+הראשון\s+הפנוי)/u.test(normalized);
  const limit = firstOnly ? 1 : parsedLimit ?? 3;
  const dayReference = extractDayReference(normalized);
  const rangeType = /(?:^|\s)השבוע(?:\s|$|[?.!,])/u.test(normalized) || /שעה\s+השבוע/u.test(normalized) ? "week" : "day";

  const check = extractCheckTime(normalized);
  if (check) {
    return {
      kind: "check",
      dayReference: check.dayReference ?? dayReference ?? "היום",
      time: check.time,
      rangeType: dayReference || check.dayReference ? "day" : rangeType,
      limit,
      durationMinutes,
    };
  }

  if (/מתי\s+(?:אני\s+)?פנוי/u.test(normalized) && !extractDayReference(normalized) && !/(?:^|\s)השבוע(?:\s|$|[?.!,])/u.test(normalized)) {
    return {
      kind: "suggest",
      rangeType: "week",
      limit,
      durationMinutes,
      firstOnly,
    };
  }

  return {
    kind: "suggest",
    rangeType: dayReference ? "day" : rangeType,
    dayReference,
    limit,
    durationMinutes,
    firstOnly,
  };
}

function mapSlots(
  slots: SuggestedSlot[],
  durationMinutes: number
): SuggestAvailableTimesProposal["slots"] {
  return slots.map((slot) => ({
    startTime: slot.startTime,
    endTime: slot.endTime,
    label: slot.label,
    durationMinutes,
  }));
}

function buildRefreshParams(intent: AvailabilityIntent): SuggestAvailableTimesProposal["refreshParams"] {
  return {
    rangeType: intent.rangeType,
    dayReference: intent.dayReference,
    durationMinutes: intent.durationMinutes,
    limit: intent.limit,
  };
}

function buildSuggestResponse(params: {
  slots: SuggestAvailableTimesProposalSlots;
  result: FindAvailableSlotsResult;
  answer: string;
  intent: SuggestAvailableTimesProposal["intent"];
  refreshParams: SuggestAvailableTimesProposal["refreshParams"];
  clientName?: string;
  dayReference?: string;
  rangeType?: "day" | "week";
}): NatalieClaudeResponse {
  return {
    action: "suggest_available_times",
    proposal: {
      slots: params.slots,
      durationMinutes: params.result.durationMinutes,
      rangeType: params.rangeType,
      dayReference: params.dayReference,
      clientName: params.clientName,
      intent: params.intent,
      refreshParams: params.refreshParams,
    },
    answer: params.answer,
  };
}

type SuggestAvailableTimesProposalSlots = SuggestAvailableTimesProposal["slots"];

function formatReasonMessage(reason: string): string {
  switch (reason) {
    case "outside_working_hours":
      return "השעה הזו מחוץ לשעות הפעילות (07:00–21:00).";
    case "past":
      return "השעה הזו כבר עברה.";
    case "bad_datetime":
      return "לא הבנתי את התאריך או השעה. אפשר לנסות שוב עם יום ושעה ברורים, למשל מחר ב-10:00.";
    default:
      return "לא הצלחתי לבדוק את הזמינות כרגע.";
  }
}

async function buildSlotsResponse(
  organizationId: string,
  intent: AvailabilityIntent,
  options?: {
    answerPrefix?: string;
    intentTag?: SuggestAvailableTimesProposal["intent"];
    clientName?: string;
    now?: Date;
  }
): Promise<NatalieClaudeResponse> {
  const result = await findAvailableSlotsForOrganization({
    organizationId,
    rangeType: intent.rangeType,
    dayReference: intent.dayReference,
    durationMinutes: intent.durationMinutes,
    limit: intent.limit,
    now: options?.now,
  });

  if (result.empty) {
    const scope =
      intent.dayReference ??
      (intent.rangeType === "week" ? "השבוע" : "היום");
    return {
      answer: `לא מצאתי זמנים פנויים ב${scope}. אפשר לנסות יום אחר או טווח רחב יותר.`,
    };
  }

  const slots = mapSlots(result.slots, result.durationMinutes);
  const prefix = options?.answerPrefix?.trim();
  const answer = prefix
    ? `${prefix} ${slots.map((slot) => slot.label).join(", ")}.`
    : `מצאתי ${slots.length} זמנים פנויים: ${slots.map((slot) => slot.label).join(", ")}.`;

  return buildSuggestResponse({
    slots,
    result,
    answer,
    intent: options?.intentTag ?? (intent.firstOnly ? "first_available" : "suggest"),
    refreshParams: buildRefreshParams(intent),
    clientName: options?.clientName,
    dayReference: intent.dayReference,
    rangeType: intent.rangeType,
  });
}

export async function maybeBuildAvailabilityResponse(
  organizationId: string,
  question: string,
  options?: { now?: Date }
): Promise<NatalieClaudeResponse | null> {
  const intent = parseAvailabilityIntent(question);
  if (intent.kind === "none") return null;
  const now = options?.now;

  if (intent.kind === "check") {
    const check = await checkSlotAvailability({
      organizationId,
      dayReference: intent.dayReference,
      time: intent.time,
      durationMinutes: intent.durationMinutes,
      now,
    });

    if (check.reason === "bad_datetime") {
      return { answer: formatReasonMessage("bad_datetime") };
    }
    if (check.reason === "outside_working_hours") {
      return { answer: formatReasonMessage("outside_working_hours") };
    }
    if (check.reason === "past") {
      return { answer: formatReasonMessage("past") };
    }

    if (check.available) {
      const label =
        check.startTime &&
        new Intl.DateTimeFormat("he-IL", {
          timeZone: check.timeZone,
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(check.startTime));
      return { answer: `כן, השעה פנויה${label ? ` — ${label}` : ""}.` };
    }

    const conflictName = check.conflict?.clientName?.trim();
    const prefix = conflictName
      ? `לא, השעה תפוסה${conflictName ? ` (תור ל${conflictName})` : ""}. אלה זמנים חלופיים:`
      : "לא, השעה תפוסה. אלה זמנים חלופיים:";

    return buildSlotsResponse(
      organizationId,
      {
        ...intent,
        kind: "suggest",
        limit: Math.max(intent.limit, 3),
        rangeType: intent.dayReference ? "day" : "week",
      },
      {
        answerPrefix: prefix,
        intentTag: "check_alternatives",
        now,
      }
    );
  }

  return buildSlotsResponse(organizationId, intent, { now });
}
