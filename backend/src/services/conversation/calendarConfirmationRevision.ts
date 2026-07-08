import {
  extractDayReference,
  parseHebrewTime,
} from "../calendar/calendarIntentParser.js";
import { calendarMessages, formatDayLabel } from "../calendar/calendarMessages.js";

const CALENDAR_REVISABLE_ACTIONS = new Set([
  "book_appointment",
  "reschedule_appointment",
  "cancel_appointment",
]);

/**
 * Detect a correction against a pending calendar confirmation
 * ("לא, בעצם ב-4" / "בעצם מחר" / "לא מחר, ביום חמישי").
 * Exact bare "לא" stays a hard reject via parseVoiceConfirmationIntent.
 */
export function isCalendarConfirmationRevisionPhrase(message: string): boolean {
  const normalized = normalizeRevisionMessage(message);
  if (!normalized) return false;
  if (/^לא$/u.test(normalized)) return false;
  if (extractCalendarConfirmationRevision(normalized)) return true;
  return false;
}

export function extractCalendarConfirmationRevision(message: string): {
  dayReference?: string;
  time?: string;
} | null {
  const normalized = normalizeRevisionMessage(message);
  if (!normalized) return null;

  const looksLikeRevisionScaffold =
    /^(?:לא\s*[,،]|לא\s+(?:מחר|מחרתיים|היום)|בעצם|יותר)/u.test(normalized) ||
    /לא\s*[,،]\s*/u.test(normalized) ||
    /בעצם/u.test(normalized);

  // "לא מחר, ביום חמישי" / "לא, ב-4" — prefer the clause after the comma.
  const afterComma = normalized.match(/^.+?[,،]\s*(.+)$/u)?.[1]?.trim();
  let focus = afterComma ?? normalized;

  focus = focus
    .replace(/^(?:לא(?:\s*[,،])?\s*)+/u, "")
    .replace(/^(?:בעצם|יותר)\s+/u, "")
    .replace(/^(?:תעביר(?:י)?|תזיז(?:י)?|תשנ(?:ה|י)|שנ(?:ה|י))\s+(?:את\s+(?:ה)?תור\s+)?/u, "")
    .trim();

  const dayReference = extractDayReference(focus) ?? undefined;
  const time = parseHebrewTime(focus) ?? undefined;

  if (!dayReference && !time) return null;

  // Bare day/time without scaffold only counts as a correction fragment
  // ("ב-4", "מחר", "ביום חמישי") — not a full new calendar command.
  if (!looksLikeRevisionScaffold) {
    const looksLikeFragment =
      /^(?:ב[-\s]?\d{1,2}(?::\d{2})?|בשעה\s+\d{1,2}|מחר|מחרתיים|היום|ב?יום\s+\S+)/u.test(
        normalized
      );
    if (!looksLikeFragment) return null;
  }

  return {
    ...(dayReference ? { dayReference } : {}),
    ...(time ? { time } : {}),
  };
}

export function canReviseCalendarPendingConfirmation(action: string | null | undefined): boolean {
  return Boolean(action && CALENDAR_REVISABLE_ACTIONS.has(action));
}

export function reviseCalendarPendingProposal(
  action: string,
  proposal: Record<string, unknown>,
  revision: { dayReference?: string; time?: string }
): { proposal: Record<string, unknown>; answer: string } | { clarify: string } {
  if (!revision.dayReference && !revision.time) {
    return { clarify: "לא הבנתי מה לשנות. אפשר לציין יום או שעה?" };
  }

  if (action === "cancel_appointment") {
    // Cancel proposals have no editable target time; ask them to reject then restate.
    return {
      clarify:
        "כדי לשנות את התור במקום לבטל, אמרי במפורש 'לא' ואז בקשו העברה עם היום והשעה החדשים.",
    };
  }

  if (action === "book_appointment") {
    const clientName = stringField(proposal.clientName);
    if (!clientName) {
      return { clarify: "לא הצלחתי לעדכן את ההצעה. אפשר לחזור על הבקשה המלאה?" };
    }
    const dayReference = revision.dayReference ?? stringField(proposal.dayReference);
    const time = revision.time ?? stringField(proposal.time);
    if (!dayReference || !time) {
      if (!dayReference) return { clarify: calendarMessages.createMissingDate(` ל${clientName}`) };
      return { clarify: calendarMessages.createMissingTime(` ל${clientName}`) };
    }
    const next = {
      ...proposal,
      dayReference,
      time,
      ...(proposal.startTime ? { startTime: undefined } : {}),
    };
    delete next.startTime;
    return {
      proposal: next,
      answer: calendarMessages.createConfirmation(clientName, formatCreateDayLabel(dayReference), time),
    };
  }

  if (action === "reschedule_appointment") {
    const clientName = stringField(proposal.clientName);
    const appointmentId = stringField(proposal.appointmentId);
    if (!clientName || !appointmentId) {
      return { clarify: "לא הצלחתי לעדכן את ההעברה. אפשר לחזור על הבקשה המלאה?" };
    }
    const newDayReference = revision.dayReference ?? stringField(proposal.newDayReference);
    const newTime = revision.time ?? stringField(proposal.newTime);
    if (!newDayReference || !newTime) {
      if (!newDayReference) return { clarify: calendarMessages.rescheduleMissingDate() };
      return { clarify: calendarMessages.rescheduleMissingTime() };
    }
    const newWhen = `${formatDayLabel(newDayReference)} בשעה ${newTime}`;
    return {
      proposal: {
        ...proposal,
        newDayReference,
        newTime,
        newWhen,
      },
      answer: calendarMessages.rescheduleConfirmation(clientName, newWhen),
    };
  }

  return { clarify: "לא הצלחתי לעדכן את ההצעה הממתינה. אפשר לנסח מחדש?" };
}

function normalizeRevisionMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatCreateDayLabel(dayReference: string): string {
  if (["מחר", "מחרתיים", "היום", "אתמול"].includes(dayReference)) return dayReference;
  return dayReference;
}
