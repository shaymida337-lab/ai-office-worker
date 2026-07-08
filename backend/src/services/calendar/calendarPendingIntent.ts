import {
  extractDayReference,
  isCancelAllTarget,
  parseCalendarIntent,
  parseHebrewTime,
  type CalendarIntentAction,
  type CalendarIntentExtraction,
  DEFAULT_BUSINESS_TIMEZONE,
} from "./calendarIntentParser.js";

export const CALENDAR_PENDING_INTENT_TTL_MS = 10 * 60 * 1000;

export type CalendarCancelTarget = "all" | "single";

export type CalendarPendingIntent = {
  intent: Exclude<CalendarIntentAction, "unknown" | "list_appointments">;
  action: "cancel_appointments" | "cancel_appointment" | "move_appointment" | "create_appointment";
  cancelTarget: CalendarCancelTarget | null;
  customerName: string | null;
  dayReference: string | null;
  date: string | null;
  time: string | null;
  fromDayReference: string | null;
  fromTime: string | null;
  missingFields: string[];
  originalUserText: string;
  lastAssistantQuestion: string;
  createdAt: string;
  expiresAt: string;
};

const FOLLOW_UP_CUSTOMER_PATTERNS = [
  // "עם רונן", "את רונן", "של רונן", "רק את רונן", "רק רונן"
  /^(?:עם|את|של|רק\s+את|רק)\s+([א-ת][א-ת\s'-]{1,30})$/u,
  // "לרונן" — prefix attaches to the name with no space.
  /^ל([א-ת][א-ת'-]{1,30})$/u,
  // Bare name: "רונן"
  /^([א-ת][א-ת'-]{1,30})$/u,
];

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function isCalendarFollowUpPhrase(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (isCancelAllTarget(normalized)) return true;
  if (/^לא\s*[,،]/u.test(normalized)) return true;
  if (/^(?:הראשון|האחרון|זה\s+שאחרי)$/u.test(normalized)) return true;
  if (extractDayReference(normalized)) return true;
  if (FOLLOW_UP_CUSTOMER_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return false;
}

const FOLLOW_UP_NAME_STOPWORDS =
  /^(?:יום|מחר|מחרתיים|היום|אתמול|כולם|כול|כל|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|השבוע|בבוקר|בערב|בצהריים|בצהרים|בלילה|שעה|בשעה|כן|לא|מאשר|מאשרת|תאשרי)$/u;

function extractFollowUpCustomerName(text: string): string | null {
  const normalized = normalize(text);
  // A follow-up that carries a time/day is not a customer-name reply.
  if (parseHebrewTime(normalized)) return null;
  for (const pattern of FOLLOW_UP_CUSTOMER_PATTERNS) {
    const match = normalized.match(pattern);
    const name = match?.[1]?.trim();
    if (!name) continue;
    if (isCancelAllTarget(name) || /^(?:כולם|כל)$/u.test(name)) continue;
    if (FOLLOW_UP_NAME_STOPWORDS.test(name)) continue;
    if (extractDayReference(name)) continue;
    return name;
  }
  return null;
}

export function isCalendarPendingIntentExpired(intent: CalendarPendingIntent, now = Date.now()): boolean {
  const expiresAt = Date.parse(intent.expiresAt);
  return Number.isFinite(expiresAt) && now > expiresAt;
}

export function calendarPendingIntentFromExtraction(
  extraction: CalendarIntentExtraction,
  params: { originalUserText: string; lastAssistantQuestion: string; now?: Date }
): CalendarPendingIntent | null {
  if (
    extraction.intent === "unknown" ||
    extraction.intent === "list_appointments" ||
    extraction.missingFields.length === 0
  ) {
    return null;
  }

  const now = params.now ?? new Date();
  const cancelTarget =
    extraction.cancelTarget ??
    (extraction.intent === "cancel_appointment" && isCancelAllTarget(extraction.rawText)
      ? "all"
      : extraction.customerName
        ? "single"
        : null);

  return {
    intent: extraction.intent,
    action:
      extraction.intent === "cancel_appointment" && cancelTarget === "all"
        ? "cancel_appointments"
        : extraction.intent,
    cancelTarget,
    customerName: extraction.customerName,
    dayReference: extraction.dayReference,
    date: extraction.date,
    time: extraction.time ?? null,
    fromDayReference: extraction.fromDayReference ?? null,
    fromTime: extraction.fromTime ?? null,
    missingFields: [...extraction.missingFields],
    originalUserText: params.originalUserText,
    lastAssistantQuestion: params.lastAssistantQuestion,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CALENDAR_PENDING_INTENT_TTL_MS).toISOString(),
  };
}

export function mergeCalendarPendingIntent(
  pending: CalendarPendingIntent,
  message: string,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
  now = new Date()
): CalendarPendingIntent {
  const normalized = normalize(message);
  const patch: Partial<CalendarPendingIntent> = {};

  if (isCancelAllTarget(normalized)) {
    patch.cancelTarget = "all";
    patch.customerName = null;
    patch.action = "cancel_appointments";
    patch.intent = "cancel_appointment";
  }

  const followUpCustomer = extractFollowUpCustomerName(normalized);
  if (followUpCustomer && !patch.customerName) {
    patch.customerName = followUpCustomer;
    if (pending.intent === "cancel_appointment") {
      patch.cancelTarget = "single";
      patch.action = "cancel_appointment";
    }
  }

  const dayReference = extractDayReference(normalized);
  if (dayReference) {
    patch.dayReference = dayReference;
    const resolved = parseCalendarIntent(`בדיקה ${dayReference}`, { timeZone, now });
    patch.date = resolved.date;
  }

  // Bare time follow-ups ("בשעה 4", "ב-10 בבוקר") complete a create/move intent.
  if (pending.intent === "create_appointment" || pending.intent === "move_appointment") {
    const followUpTime = parseHebrewTime(normalized);
    if (followUpTime) patch.time = followUpTime;
  }

  if (/^לא\s*[,،]/u.test(normalized)) {
    const remainder = normalized.replace(/^לא\s*[,،]\s*/u, "");
    const newDay = extractDayReference(remainder);
    const newTime = parseHebrewTime(remainder);
    if (newDay) {
      patch.dayReference = newDay;
      const resolved = parseCalendarIntent(`בדיקה ${newDay}`, { timeZone, now });
      patch.date = resolved.date;
    }
    if (newTime) patch.time = newTime;
  }

  const merged: CalendarPendingIntent = {
    ...pending,
    ...patch,
    missingFields: [...pending.missingFields],
  };

  // Intent lock: slot-filling follow-ups must stay on the original calendar intent.
  if (merged.intent !== pending.intent) {
    merged.intent = pending.intent;
    if (pending.intent === "create_appointment") {
      merged.action = "create_appointment";
    } else if (pending.intent === "move_appointment") {
      merged.action = "move_appointment";
    } else if (pending.intent === "cancel_appointment") {
      merged.action = pending.cancelTarget === "all" ? "cancel_appointments" : "cancel_appointment";
    }
  }

  merged.missingFields = recomputeMissingFields(merged);
  if (merged.cancelTarget === "all") {
    merged.action = "cancel_appointments";
  }
  return merged;
}

export function recomputeMissingFields(intent: CalendarPendingIntent): string[] {
  const missing: string[] = [];
  if (intent.intent === "cancel_appointment") {
    if (!intent.cancelTarget) missing.push("target");
    if (intent.cancelTarget === "single" && !intent.customerName) missing.push("customerName");
    if (intent.cancelTarget === "all" && !intent.dayReference) missing.push("date");
    if (intent.cancelTarget === "single" && !intent.dayReference && !intent.customerName) {
      missing.push("date");
    }
    return missing;
  }
  if (intent.intent === "move_appointment") {
    if (!intent.customerName) missing.push("customerName");
    if (!intent.dayReference) missing.push("date");
    if (!intent.time) missing.push("time");
    return missing;
  }
  if (intent.intent === "create_appointment") {
    if (!intent.customerName) missing.push("customerName");
    if (!intent.dayReference) missing.push("date");
    if (!intent.time) missing.push("time");
    return missing;
  }
  return missing;
}

export function parseInitialCalendarPendingIntent(
  message: string,
  options: { timeZone?: string; now?: Date } = {}
): CalendarPendingIntent | null {
  const extraction = parseCalendarIntent(message, options);
  if (extraction.missingFields.length === 0) return null;
  const question = clarificationQuestionForIntent(extraction);
  return calendarPendingIntentFromExtraction(extraction, {
    originalUserText: message,
    lastAssistantQuestion: question,
    now: options.now,
  });
}

export function clarificationQuestionForIntent(extraction: CalendarIntentExtraction): string {
  if (extraction.intent === "cancel_appointment") {
    if (extraction.missingFields.includes("date") && extraction.cancelTarget === "all") {
      return "לאיזה יום לבטל את כל התורים?";
    }
    if (extraction.missingFields.includes("target") || extraction.missingFields.includes("customerName")) {
      return "לא הבנתי למי לבטל. מה שם הלקוח/ה?";
    }
    return "לא הבנתי איזה תור לבטל. למי התכוונת?";
  }
  if (extraction.intent === "move_appointment") {
    if (extraction.missingFields.includes("customerName")) return "לא הבנתי למי להעביר. מה שם הלקוח/ה?";
    if (extraction.missingFields.includes("date")) return "לאיזה יום להעביר את התור?";
    if (extraction.missingFields.includes("time")) return "לאיזה שעה להעביר את התור?";
  }
  if (extraction.intent === "create_appointment") {
    if (extraction.missingFields.includes("customerName")) return "לא הבנתי למי לקבוע את התור. מה שם הלקוח/ה?";
    if (extraction.missingFields.includes("date")) return "לאיזה יום לקבוע את התור?";
    if (extraction.missingFields.includes("time")) return "באיזו שעה לקבוע את התור?";
  }
  return "לא הבנתי את הבקשה ליומן. אפשר לנסח שוב עם שם, יום ושעה?";
}

export function readCalendarPendingIntent(
  pendingAction: { action: string; proposal: Record<string, unknown> } | null
): CalendarPendingIntent | null {
  if (!pendingAction || pendingAction.action !== "calendar_intent_continuation") return null;
  const raw = pendingAction.proposal?.intent as CalendarPendingIntent | undefined;
  if (!raw || typeof raw !== "object" || !raw.intent) return null;
  return raw;
}

export function calendarPendingAction(intent: CalendarPendingIntent) {
  return {
    action: "calendar_intent_continuation" as const,
    proposal: { intent },
  };
}
