import { resolveSlotTime } from "./datetime.js";

export type CalendarIntentAction =
  | "create_appointment"
  | "cancel_appointment"
  | "move_appointment"
  | "unknown";

export type CalendarIntentConfidence = "high" | "medium" | "low";

/** Deterministic structured extraction for Hebrew calendar phrases. */
export type CalendarIntentExtraction = {
  intent: CalendarIntentAction;
  customerName: string | null;
  dayReference: string | null;
  /** Resolved wall-clock date (YYYY-MM-DD) in the business timezone, when resolvable. */
  date: string | null;
  /** 24h HH:MM in the business timezone. */
  time: string | null;
  fromDayReference?: string | null;
  fromTime?: string | null;
  durationMinutes: number | null;
  serviceName: string | null;
  notes: string | null;
  confidence: CalendarIntentConfidence;
  missingFields: string[];
  rawText: string;
};

export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Jerusalem";

/** Words that must never be treated as a customer name (explanation/command noise). */
const CUSTOMER_NAME_STOPWORDS = [
  "ברורה",
  "ברור",
  "הבנתי",
  "מבינה",
  "צריך",
  "צריכה",
  "לקבוע",
  "לזמן",
  "תור",
  "תורים",
  "פגישה",
  "פגישות",
  "מחר",
  "מחרתיים",
  "היום",
  "שעה",
  "בשעה",
  "בבוקר",
  "בערב",
  "בצהריים",
  "בלילה",
  "אתמול",
  "עכשיו",
];

const TIME_CONTEXT = {
  morning: /בבוקר|בוקר/u,
  noon: /בצהריים|בצהרים|צהריים|צהרים/u,
  evening: /בערב|ערב/u,
  night: /בלילה|לילה/u,
};

const HEBREW_HOUR_WORDS: Record<string, number> = {
  אחת: 1,
  שתיים: 2,
  שתים: 2,
  שניים: 2,
  שתי: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
};

const DATE_TIME_BOUNDARY =
  /(?:^|\s)(?:ממחרתיים|ממחר|מהיום|מחרתיים|מחר|היום|ביום|בשעה|ב-?\d|ב\s+\d|בבוקר|בערב|בצהריים|בצהרים|בלילה|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|בשלושה|בשלוש|בארבעה|בארבע|בחמישה|בחמש|בשישה|בשש|בשבעה|בשבע|בשמונה|בתשעה|בתשע|בעשרה|בעשר|באחת|בשתיים|בשניים|\d{1,2}[:.]\d{2}|\d{1,2}[./]\d{1,2})/u;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Apply Hebrew business-hours convention: bare 1–11 → afternoon unless morning context. */
function applyHourContext(hour: number, contextText: string): number {
  if (hour < 0 || hour > 23) return hour;
  if (TIME_CONTEXT.morning.test(contextText)) {
    return hour === 12 ? 0 : hour;
  }
  if (TIME_CONTEXT.noon.test(contextText)) {
    return 12;
  }
  if (TIME_CONTEXT.evening.test(contextText) || TIME_CONTEXT.night.test(contextText)) {
    return hour >= 1 && hour <= 11 ? hour + 12 : hour;
  }
  // No explicit context: business default — single-digit hours 1–9 are read as
  // afternoon (3 → 15:00), while 10/11 stay morning business hours (10 → 10:00).
  if (hour >= 1 && hour <= 9) return hour + 12;
  return hour;
}

function toTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parse a Hebrew time expression from a segment.
 * Handles "ב-3", "ב 3", "בשעה 3", "בשלוש", "15:00", "8 בערב".
 * Returns 24h HH:MM or null.
 */
export function parseHebrewTime(segment: string): string | null {
  const text = normalize(segment);

  // Explicit HH:MM — respect the given hour verbatim (already 24h or morning).
  const explicit = text.match(/(?<!\d)(\d{1,2})[:.](\d{2})(?!\d)/u);
  if (explicit) {
    const hour = Number(explicit[1]);
    const minute = Number(explicit[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      // For a bare "3:30" with no context and hour<12, keep as stated only if >=13;
      // otherwise apply context (evening) but default business hours keep morning-safe minute.
      if (hour >= 13) return toTime(hour, minute);
      const adjusted = applyHourContext(hour, text);
      return toTime(adjusted, minute);
    }
    return null;
  }

  // Numeric hour: "ב-3", "ב 3", "בשעה 3", "3 בערב"
  const numeric = text.match(/(?:בשעה\s*|ב[-\s]?)?(?<hour>\d{1,2})(?=\s|$|\D)/u);
  // Hebrew word boundaries (\b) do not work with Hebrew letters, so match longer
  // variants first and allow an attached "ב" prefix ("בשלוש").
  const hebrewWord = text.match(
    /(?:^|\s|ב)(?<word>אחת עשרה|שתים עשרה|שתיים|שתים|שניים|שלושה|שלוש|ארבעה|ארבע|חמישה|חמש|שישה|שבעה|שבע|שמונה|תשעה|תשע|עשרה|עשר|שש|אחת)/u
  );

  let hour: number | null = null;
  if (hebrewWord?.groups?.word) {
    hour = HEBREW_HOUR_WORDS[hebrewWord.groups.word] ?? null;
  } else if (numeric?.groups?.hour) {
    hour = Number(numeric.groups.hour);
  }

  if (hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    // Context-only expressions with no explicit hour ("בצהריים").
    if (TIME_CONTEXT.noon.test(text)) return toTime(12, 0);
    return null;
  }
  const adjusted = applyHourContext(hour, text);
  return toTime(adjusted, 0);
}

export function extractDayReference(text: string): string | null {
  if (/(?:^|\s)ל?מחרתיים(?:\s|$|[?.!,])/u.test(text)) return "מחרתיים";
  if (/(?:^|\s)ל?מחר(?:\s|$|[?.!,])/u.test(text)) return "מחר";
  if (/(?:^|\s)ל?היום(?:\s|$|[?.!,])/u.test(text)) return "היום";
  const weekday = text.match(/(?:ב?יום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/u);
  if (weekday) return `יום ${weekday[1]}`;
  const dateMatch = text.match(/(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/u);
  if (dateMatch) return dateMatch[1];
  return null;
}

function looksLikeStopword(name: string): boolean {
  const tokens = name.split(/\s+/u);
  return tokens.some((token) => {
    const clean = token.replace(/[.?!,]+$/u, "");
    return CUSTOMER_NAME_STOPWORDS.includes(clean);
  });
}

/** Extract a customer name after the "ל" preposition, cutting at date/time markers. */
export function extractCustomerName(text: string): string | null {
  const normalized = normalize(text);
  const afterAppointmentNoun = normalized.match(/(?:תור|פגישה)\s+ל([^\s].*)$/u);
  const afterVerb = normalized.match(
    /(?:תקבעי|תקבע|קבעי|קבע|תזמני|תזמן|תרשמי|תרשום|רשמי|רשום)\s+ל([^\s].*)$/u
  );
  const afterCancelMove = normalized.match(
    /(?:של)\s+ל?([^\s].*)$/u
  );

  const raw = afterAppointmentNoun?.[1] ?? afterVerb?.[1] ?? afterCancelMove?.[1] ?? null;
  if (!raw) return null;

  // Cut at the first date/time boundary token.
  const boundary = raw.search(DATE_TIME_BOUNDARY);
  let candidate = (boundary >= 0 ? raw.slice(0, boundary) : raw).trim();
  candidate = candidate.replace(/[.?!,]+$/u, "").trim();

  if (!candidate) return null;
  if (candidate.length < 2) return null;
  if (looksLikeStopword(candidate)) return null;
  // A customer name should be at most 3 tokens (first + last + optional).
  if (candidate.split(/\s+/u).length > 3) {
    candidate = candidate.split(/\s+/u).slice(0, 2).join(" ");
  }
  return candidate;
}

function detectIntent(text: string): CalendarIntentAction {
  if (/(?:תזיז|תזיזי|תעביר|תעבירי|תשני|תשנה|שנה\s+מועד|לשנות\s+את\s+התור|לדחות)/u.test(text)) {
    return "move_appointment";
  }
  if (/(?:תבטל|תבטלי|בטל|בטלי|ביטול|לבטל)/u.test(text)) {
    return "cancel_appointment";
  }
  if (
    /(?:תקבעי|תקבע|קבעי|קבע|תזמני|תזמן|תרשמי|תרשום|רשמי|רשום|לקבוע|לזמן)/u.test(text) &&
    /(?:תור|פגישה|ל[א-ת])/u.test(text)
  ) {
    return "create_appointment";
  }
  return "unknown";
}

function resolveDate(
  dayReference: string | null,
  time: string | null,
  timeZone: string,
  now: Date
): string | null {
  if (!dayReference) return null;
  const resolved = resolveSlotTime({
    dayReference,
    time: time ?? "12:00",
    timeZone,
    now,
  });
  if (!resolved || Number.isNaN(resolved.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(resolved);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type ExtractionValidation = {
  valid: boolean;
  issues: string[];
  extraction: CalendarIntentExtraction;
};

/**
 * Post-extraction safety net (also guards any future LLM output): reject
 * customer names that are really explanation/command noise, and any create
 * intent that lost a field the user clearly provided.
 */
export function validateExtraction(
  extraction: CalendarIntentExtraction
): ExtractionValidation {
  const issues: string[] = [];
  const name = extraction.customerName;

  if (name) {
    if (looksLikeStopword(name)) {
      issues.push("customerName_is_noise");
    }
    if (/\d/u.test(name)) {
      issues.push("customerName_contains_digits");
    }
    if (name.length > 40) {
      issues.push("customerName_too_long");
    }
  }

  // A create/move must not silently default a time when the user gave one.
  const userGaveTime =
    /\d{1,2}[:.]\d{2}|ב[-\s]?\d|בשעה|בשלוש|בארבע|בחמש|בשש|בשבע|בשמונה|בתשע|בעשר|באחת|בשתיים|בשניים|בבוקר|בערב|בצהריים|בצהרים|בלילה/u.test(
      extraction.rawText
    );
  if (
    (extraction.intent === "create_appointment" ||
      extraction.intent === "move_appointment") &&
    userGaveTime &&
    !extraction.time
  ) {
    issues.push("time_provided_but_unparsed");
  }

  return { valid: issues.length === 0, issues, extraction };
}

export type ParseCalendarIntentOptions = {
  timeZone?: string;
  now?: Date;
};

export function parseCalendarIntent(
  rawText: string,
  options: ParseCalendarIntentOptions = {}
): CalendarIntentExtraction {
  const timeZone = options.timeZone ?? DEFAULT_BUSINESS_TIMEZONE;
  const now = options.now ?? new Date();
  const text = normalize(rawText);
  const intent = detectIntent(text);

  const base: CalendarIntentExtraction = {
    intent,
    customerName: null,
    dayReference: null,
    date: null,
    time: null,
    durationMinutes: null,
    serviceName: null,
    notes: null,
    confidence: "low",
    missingFields: [],
    rawText,
  };

  if (intent === "unknown") {
    return { ...base, missingFields: ["intent"] };
  }

  const customerName = extractCustomerName(text);

  if (intent === "move_appointment") {
    // "תזיזי את התור של שרית ממחר בשלוש למחר בארבע"
    // Structured "from ... to ..." pattern: מ<day> <time> ל<day> <time>.
    const moveMatch = text.match(
      /מ(מחר|מחרתיים|היום|יום\s+\S+)\s+(\S+)\s+ל(מחר|מחרתיים|היום|יום\s+\S+)\s+(\S+)/u
    );

    let fromDayReference: string | null = null;
    let fromTime: string | null = null;
    let dayReference: string | null = null;
    let time: string | null = null;

    if (moveMatch) {
      fromDayReference = extractDayReference(moveMatch[1]);
      fromTime = parseHebrewTime(moveMatch[2]);
      dayReference = extractDayReference(moveMatch[3]);
      time = parseHebrewTime(moveMatch[4]);
    } else {
      // Fallback: only a single target ("תזיזי את התור של שרית למחר בארבע").
      const targetSegment = text.split(/(?:^|\s)ל(?=מחר|מחרתיים|היום|יום\s)/u).pop() ?? text;
      dayReference = extractDayReference(targetSegment) ?? extractDayReference(text);
      time = parseHebrewTime(targetSegment);
    }

    const missingFields: string[] = [];
    if (!customerName) missingFields.push("customerName");
    if (!dayReference) missingFields.push("date");
    if (!time) missingFields.push("time");
    return {
      ...base,
      customerName,
      dayReference,
      date: resolveDate(dayReference, time, timeZone, now),
      time,
      fromDayReference,
      fromTime,
      confidence: missingFields.length === 0 && customerName ? "high" : "low",
      missingFields,
    };
  }

  if (intent === "cancel_appointment") {
    const dayReference = extractDayReference(text);
    const missingFields: string[] = [];
    if (!customerName) missingFields.push("customerName");
    return {
      ...base,
      customerName,
      dayReference,
      date: resolveDate(dayReference, null, timeZone, now),
      confidence: customerName ? "high" : "low",
      missingFields,
    };
  }

  // create_appointment
  const dayReference = extractDayReference(text);
  const time = parseHebrewTime(text);
  const missingFields: string[] = [];
  if (!customerName) missingFields.push("customerName");
  if (!dayReference) missingFields.push("date");
  if (!time) missingFields.push("time");

  return {
    ...base,
    customerName,
    dayReference,
    date: resolveDate(dayReference, time, timeZone, now),
    time,
    confidence: missingFields.length === 0 ? "high" : "low",
    missingFields,
  };
}
