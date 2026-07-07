import { parseAvailabilityIntent } from "../natalieAvailability.js";
import type { CalendarCommandAction, CalendarCommandConfidence, ParsedCalendarCommand } from "./calendarCommandTypes.js";

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function base(action: CalendarCommandAction, rawText: string, confidence: CalendarCommandConfidence): ParsedCalendarCommand {
  return { action, rawText, confidence };
}

function extractDayReference(normalized: string): string | undefined {
  if (/(?:^|\s)today(?:\s|$|[?.!,])/iu.test(normalized)) return "today";
  if (/(?:^|\s)tomorrow(?:\s|$|[?.!,])/iu.test(normalized)) return "tomorrow";
  if (/(?:^|\s)היום(?:\s|$|[?.!,])/u.test(normalized)) return "היום";
  if (/(?:^|\s)מחרתיים(?:\s|$|[?.!,])/u.test(normalized)) return "מחרתיים";
  if (/(?:^|\s)מחר(?:\s|$|[?.!,])/u.test(normalized)) return "מחר";
  const weekday = normalized.match(
    /(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)|(?:on\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)/iu
  );
  if (weekday) return weekday[0].trim();
  const dateMatch = normalized.match(/(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/u);
  if (dateMatch) return dateMatch[1];
  return undefined;
}

function extractTime(normalized: string): string | undefined {
  const atMatch = normalized.match(/(?:at|בשעה|ב[-\s]?)(?<time>\d{1,2}(?::\d{2})?)/iu);
  if (atMatch?.groups?.time) return atMatch.groups.time;
  const bare = normalized.match(/(?<!\d)(?<time>\d{1,2}:\d{2})(?!\d)/u);
  if (bare?.groups?.time) return bare.groups.time;
  return undefined;
}

function extractCustomerFromCreate(normalized: string): string | undefined {
  const hebrewPatterns = [
    /(?:קבע|תקבע|תרשמ|רשמ|תזמין|תזמני)\s+(?:תור|פגישה)?\s*(?:ל|עם|של)?\s*(?<name>.+?)(?:\s+(?:מחר|היום|מחרתיים|בשעה|ב[-\s]?\d)|\s*[.?!]|$)/iu,
    /(?:schedule|book)\s+(?<name>[A-Za-z\u0590-\u05FF][A-Za-z\u0590-\u05FF\s'-]+?)\s+(?:tomorrow|today|on)/iu,
    /(?:schedule|book)\s+(?:an?\s+)?(?:appointment|meeting)\s+(?:for|with)\s+(?<name>.+?)(?:\s+(?:tomorrow|today|at)|\s*[.?!]|$)/iu,
  ];
  for (const pattern of hebrewPatterns) {
    const match = normalized.match(pattern);
    const name = match?.groups?.name?.trim().replace(/[.?!]+$/, "");
    if (name && name.length >= 2) return name;
  }
  return undefined;
}

function extractCustomerFromCancel(normalized: string): string | undefined {
  if (/(?:תעביר|תעבירי|תשני|תשנה|שנה\s+מועד|move|reschedule)/iu.test(normalized)) return undefined;
  const patterns = [
    /(?:בטל|בטלי|cancel)\s+(?:את\s+)?(?:ה)?(?:תור|appointment)?\s*(?:של|ל|for)?\s*(?<name>.+?)(?:\s*[.?!]|$)/iu,
    /ביטול\s+(?:ה)?תור\s+(?:של|ל)\s+(?<name>.+?)(?:\s*[.?!]|$)/iu,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const name = match?.groups?.name?.trim().replace(/[.?!]+$/, "");
    if (name && name.length >= 2) return name;
  }
  return undefined;
}

function extractCustomerFromMove(normalized: string): string | undefined {
  const patterns = [
    /(?:תעביר|תעבירי|תשני|תשנה|שנה\s+מועד|move|reschedule)\s+(?:את\s+)?(?:ה)?(?:תור|appointment)?\s*(?:של|ל|for)?\s*(?<name>.+?)(?:\s+(?:ל|to|מחר|היום|tomorrow|today|בשעה|at)|\s*[.?!]|$)/iu,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const name = match?.groups?.name?.trim().replace(/[.?!]+$/, "");
    if (name && name.length >= 2) return name;
  }
  return undefined;
}

function parseListOrSearch(normalized: string): ParsedCalendarCommand | null {
  if (/(?:list|show|מה\s+התורים|התורים\s+שלי|תורים\s+היום|upcoming\s+appointments)/iu.test(normalized)) {
    const searchMatch = normalized.match(
      /(?:find|search|חפש|חפשי|תור\s+של)\s+(?<query>.+?)(?:\s*[.?!]|$)/iu
    );
    if (searchMatch?.groups?.query) {
      return {
        ...base("search", normalized, "high"),
        searchQuery: searchMatch.groups.query.trim(),
        limit: 10,
      };
    }
    return { ...base("list", normalized, "high"), limit: 20, rangeType: /השבוע|this\s+week/iu.test(normalized) ? "week" : "day" };
  }
  if (/(?:find|search|חפש|חפשי)\s+(?:תור|appointment)/iu.test(normalized)) {
    const query = normalized
      .replace(/^(?:find|search|חפש|חפשי)\s+(?:תור|appointment)\s*(?:של|for)?\s*/iu, "")
      .replace(/[.?!]+$/, "")
      .trim();
    if (query) {
      return { ...base("search", normalized, "high"), searchQuery: query, limit: 10 };
    }
  }
  return null;
}

function parseCancel(normalized: string): ParsedCalendarCommand | null {
  if (!/(?:בטל|בטלי|ביטול|cancel)/iu.test(normalized)) return null;
  if (/(?:תעביר|תעבירי|תשני|תשנה|move|reschedule)/iu.test(normalized)) return null;
  return {
    ...base("cancel", normalized, "high"),
    customer: extractCustomerFromCancel(normalized),
  };
}

function parseMove(normalized: string): ParsedCalendarCommand | null {
  if (!/(?:תעביר|תעבירי|תשני|תשנה|שנה\s+מועד|move|reschedule)/iu.test(normalized)) return null;
  return {
    ...base("move", normalized, "high"),
    customer: extractCustomerFromMove(normalized),
    dayReference: extractDayReference(normalized),
    time: extractTime(normalized),
  };
}

function parseCreate(normalized: string): ParsedCalendarCommand | null {
  const bookSignals =
    /(?:קבע|תקבע|תרשמ|רשמ|תזמין|תזמני|schedule|book)/iu.test(normalized) &&
    (/(?:תור|פגישה|appointment|meeting)/iu.test(normalized) ||
      /(?:schedule|book)\s+[A-Za-z\u0590-\u05FF]/iu.test(normalized));
  const implicitBook =
    /(?:ל|for|with)\s+\S+/iu.test(normalized) &&
    (extractDayReference(normalized) || extractTime(normalized)) &&
    !/(?:בטל|cancel|פנוי|available)/iu.test(normalized);
  if (!bookSignals && !implicitBook) return null;
  if (/(?:פנוי|מקום\s+פנוי|available)/iu.test(normalized) && !/(?:קבע|תקבע|schedule|book)/iu.test(normalized)) {
    return null;
  }
  return {
    ...base("create", normalized, bookSignals ? "high" : "medium"),
    customer: extractCustomerFromCreate(normalized),
    dayReference: extractDayReference(normalized),
    time: extractTime(normalized),
  };
}

function parseAvailability(normalized: string, rawText: string): ParsedCalendarCommand | null {
  const intent = parseAvailabilityIntent(rawText);
  if (intent.kind === "none") return null;
  const time = intent.time ?? extractTime(normalized);
  if (intent.kind === "check" || time) {
    return {
      ...base("availability_check", normalized, "high"),
      dayReference: intent.dayReference ?? extractDayReference(normalized),
      time,
      durationMinutes: intent.durationMinutes,
      rangeType: intent.rangeType,
      limit: intent.limit,
    };
  }
  return {
    ...base("availability_suggest", normalized, "high"),
    dayReference: intent.dayReference,
    durationMinutes: intent.durationMinutes,
    rangeType: intent.rangeType,
    limit: intent.limit,
  };
}

/** Convert natural language (Hebrew/English) into a structured calendar command. */
export function parseCalendarCommand(rawText: string): ParsedCalendarCommand {
  const normalized = normalize(rawText);
  if (!normalized) {
    return base("unknown", rawText, "low");
  }

  const availability = parseAvailability(normalized, rawText);
  if (availability) return availability;

  const cancel = parseCancel(normalized);
  if (cancel) return cancel;

  const move = parseMove(normalized);
  if (move) return move;

  const create = parseCreate(normalized);
  if (create) return create;

  const listOrSearch = parseListOrSearch(normalized);
  if (listOrSearch) return listOrSearch;

  return base("unknown", rawText, "low");
}
