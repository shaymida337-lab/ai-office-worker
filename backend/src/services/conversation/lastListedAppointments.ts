import type { SchedulingSource } from "../scheduling/schedulingReadRepository.js";
import type { UpcomingSchedulingItem } from "../scheduling/schedulingFacade.js";
import type { ConversationSessionRecord } from "./conversationTypes.js";

export const LAST_LISTED_APPOINTMENTS_ACTION = "last_listed_appointments";

export type ListedAppointmentItem = {
  appointmentId: string;
  source: SchedulingSource;
  startTime: string;
  endTime: string;
  customerName: string;
  serviceName?: string;
  clientId?: string | null;
};

export type ListableSchedulingItem = UpcomingSchedulingItem & {
  clientId?: string | null;
  source?: SchedulingSource;
};

export type ListedPreferredAction = "cancel_appointment" | "reschedule_appointment";

export type ListedAppointmentFilter = {
  dayReference?: string;
  time?: string;
};

export function buildLastListedAppointmentsPendingAction(
  items: ListableSchedulingItem[],
  options?: {
    preferredAction?: ListedPreferredAction;
    clientId?: string | null;
    clientName?: string | null;
    ttlMs?: number;
  }
): ConversationSessionRecord["pendingAction"] {
  const ttlMs = options?.ttlMs ?? 10 * 60 * 1000;
  return {
    action: LAST_LISTED_APPOINTMENTS_ACTION,
    proposal: {
      items: items.map(toListedAppointmentItem),
      listedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      ...(options?.preferredAction ? { preferredAction: options.preferredAction } : {}),
      ...(options?.clientId ? { clientId: options.clientId } : {}),
      ...(options?.clientName ? { clientName: options.clientName } : {}),
    },
  };
}

export function readLastListedAppointments(
  session: Pick<ConversationSessionRecord, "pendingAction" | "structuredHistory">
): ListedAppointmentItem[] {
  const fromPending = listedItemsFromPending(session.pendingAction);
  if (fromPending.length > 0) return fromPending;

  for (let i = session.structuredHistory.length - 1; i >= 0; i -= 1) {
    const turn = session.structuredHistory[i]!;
    if (turn.action !== LAST_LISTED_APPOINTMENTS_ACTION || !turn.proposal) continue;
    const items = listedItemsFromProposal(turn.proposal);
    if (items.length > 0) return items;
  }
  return [];
}

export function readListedPreferredAction(
  session: Pick<ConversationSessionRecord, "pendingAction" | "structuredHistory">
): ListedPreferredAction | null {
  const fromPending = preferredActionFromProposal(session.pendingAction?.proposal);
  if (fromPending) return fromPending;
  for (let i = session.structuredHistory.length - 1; i >= 0; i -= 1) {
    const turn = session.structuredHistory[i]!;
    if (turn.action !== LAST_LISTED_APPOINTMENTS_ACTION || !turn.proposal) continue;
    const preferred = preferredActionFromProposal(turn.proposal);
    if (preferred) return preferred;
  }
  return null;
}

export type ListedAppointmentOrdinal =
  | { kind: "index"; index: number }
  | { kind: "first" }
  | { kind: "last" }
  | { kind: "query_last" };

/**
 * Parse list-relative follow-ups:
 * - תבטלי את הראשון
 * - תעבירי את השני
 * - מה האחרון?
 * - תבטלי את התור של יום ראשון
 * - הראשון (apply preferred action)
 */
export function parseListedAppointmentOrdinalCommand(message: string): {
  intent: "cancel_appointment" | "reschedule_appointment" | "inspect" | "apply_preferred";
  ordinal: ListedAppointmentOrdinal | null;
  filter?: ListedAppointmentFilter;
  dayReference?: string;
  time?: string;
} | null {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (!normalized) return null;

  const filter = parseListedAppointmentFilter(normalized);
  const ordinal = parseOrdinalToken(normalized);

  if (
    /(?:תבטל|תבטלי|בטל|בטלי)\s+(?:את\s+)?(?:ה)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שביעי|שמיני|תשיעי|עשירי|אחרון|\d+)/u.test(
      normalized
    ) ||
    /(?:תבטל|תבטלי|בטל|בטלי)\s+את\s+(?:ה)?(?:ראשון|שני|אחרון)/u.test(normalized)
  ) {
    if (!ordinal) return null;
    return { intent: "cancel_appointment", ordinal, ...(filter ? { filter } : {}) };
  }

  if (
    /(?:תעביר|תעבירי|תזיז|תזיזי|תשנה|תשני)\s+(?:את\s+)?(?:ה)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שביעי|שמיני|תשיעי|עשירי|אחרון|\d+)/u.test(
      normalized
    )
  ) {
    if (!ordinal) return null;
    return { intent: "reschedule_appointment", ordinal, ...(filter ? { filter } : {}) };
  }

  if (
    ordinal?.kind === "query_last" ||
    /(?:מה|איזה|מי)\s+(?:ה)?(?:ראשון|שני|אחרון)/u.test(normalized)
  ) {
    return {
      intent: "inspect",
      ordinal: ordinal?.kind === "query_last" || !ordinal ? { kind: "last" } : ordinal,
    };
  }

  // Filter cancel/reschedule without ordinal: "תבטלי את התור של יום ראשון" / "של 10:00"
  if (filter && isFilterOnlyCancelOrMove(normalized, "cancel")) {
    return { intent: "cancel_appointment", ordinal: null, filter };
  }
  if (filter && isFilterOnlyCancelOrMove(normalized, "reschedule")) {
    return { intent: "reschedule_appointment", ordinal: null, filter };
  }

  // Confirmation / pronoun cancel against the chooser list.
  if (
    /^(?:כן|כן\.|בטח|סבבה|תבטל(?:י)?\s+אות(?:ו|ה)|בטל(?:י)?\s+אות(?:ו|ה)|אותו\s+אחד|אותה\s+אחת)$/u.test(
      normalized
    )
  ) {
    return { intent: "apply_preferred", ordinal: null, ...(filter ? { filter } : {}) };
  }

  // Bare ordinal: "הראשון" / "השני" / "2"
  if (ordinal && isBareOrdinalPhrase(normalized)) {
    return { intent: "apply_preferred", ordinal, ...(filter ? { filter } : {}) };
  }

  // Filter-only selection: "של יום ראשון" / "של 10:00" / "התור של 19 ביולי"
  if (filter && isSelectionShapedPhrase(normalized) && !hasConflictingNonSelectionContent(normalized)) {
    return { intent: "apply_preferred", ordinal: null, filter };
  }

  return null;
}

export function resolveListedAppointmentByOrdinal(
  items: ListedAppointmentItem[],
  ordinal: ListedAppointmentOrdinal
): ListedAppointmentItem | null {
  if (items.length === 0) return null;
  if (ordinal.kind === "first") return items[0] ?? null;
  if (ordinal.kind === "last" || ordinal.kind === "query_last") return items[items.length - 1] ?? null;
  if (ordinal.index < 0 || ordinal.index >= items.length) return null;
  return items[ordinal.index] ?? null;
}

/**
 * Filter previously listed appointments by day/time cues from a chooser follow-up.
 * Weekday references match by local weekday of each listed item (not "next" weekday from now).
 */
export function filterListedAppointments(
  items: ListedAppointmentItem[],
  filter: ListedAppointmentFilter | undefined,
  timeZone: string,
  _now: Date = new Date()
): ListedAppointmentItem[] {
  if (!filter) return items;
  let result = items;

  if (filter.dayReference) {
    const weekday = weekdayFromDayReference(filter.dayReference);
    if (weekday !== null) {
      result = result.filter((item) => localWeekday(new Date(item.startTime), timeZone) === weekday);
    } else {
      const relative = relativeDayOffset(filter.dayReference);
      if (relative !== null) {
        const targetLocal = localDateKey(addLocalDays(_now, relative, timeZone), timeZone);
        result = result.filter((item) => localDateKey(new Date(item.startTime), timeZone) === targetLocal);
      }
    }
  }

  if (filter.time) {
    const want = normalizeTimeLabel(filter.time);
    if (want) {
      result = result.filter((item) => {
        const label = new Intl.DateTimeFormat("en-GB", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(item.startTime));
        return normalizeTimeLabel(label) === want;
      });
    }
  }

  return result;
}

function toListedAppointmentItem(item: ListableSchedulingItem): ListedAppointmentItem {
  const start = item.startTime instanceof Date ? item.startTime : new Date(item.startTime);
  const end = new Date(start.getTime() + Math.max(1, item.durationMinutes) * 60_000);
  return {
    appointmentId: item.id,
    source: item.source ?? "appointment",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    customerName: item.clientName,
    ...(item.serviceName ? { serviceName: item.serviceName } : {}),
    clientId: item.clientId ?? null,
  };
}

function listedItemsFromPending(
  pendingAction: ConversationSessionRecord["pendingAction"]
): ListedAppointmentItem[] {
  if (!pendingAction || pendingAction.action !== LAST_LISTED_APPOINTMENTS_ACTION) return [];
  return listedItemsFromProposal(pendingAction.proposal);
}

function listedItemsFromProposal(proposal: Record<string, unknown>): ListedAppointmentItem[] {
  const raw = proposal.items;
  if (!Array.isArray(raw)) return [];
  const items: ListedAppointmentItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const appointmentId = typeof row.appointmentId === "string" ? row.appointmentId.trim() : "";
    const customerName = typeof row.customerName === "string" ? row.customerName.trim() : "";
    const startTime = typeof row.startTime === "string" ? row.startTime : "";
    const endTime = typeof row.endTime === "string" ? row.endTime : "";
    const source = row.source;
    if (
      !appointmentId ||
      !customerName ||
      !startTime ||
      !endTime ||
      (source !== "appointment" && source !== "calendar_event" && source !== "google_calendar")
    ) {
      continue;
    }
    items.push({
      appointmentId,
      source,
      startTime,
      endTime,
      customerName,
      ...(typeof row.serviceName === "string" ? { serviceName: row.serviceName } : {}),
      clientId: typeof row.clientId === "string" ? row.clientId : null,
    });
  }
  return items;
}

function preferredActionFromProposal(
  proposal: Record<string, unknown> | null | undefined
): ListedPreferredAction | null {
  if (!proposal) return null;
  const value = proposal.preferredAction;
  if (value === "cancel_appointment" || value === "reschedule_appointment") return value;
  return null;
}

function parseOrdinalToken(text: string): ListedAppointmentOrdinal | null {
  if (/(?:מה|איזה)\s+(?:ה)?אחרון/u.test(text)) return { kind: "query_last" };
  if (/(?:^|[\s])(?:ה)?ראשון(?:\s|$|[?.!])/u.test(text)) return { kind: "first" };
  if (/(?:^|[\s])(?:ה)?אחרון(?:\s|$|[?.!])/u.test(text)) return { kind: "last" };

  const hebrewIndex: Record<string, number> = {
    שני: 1,
    שלישי: 2,
    רביעי: 3,
    חמישי: 4,
    שישי: 5,
    שביעי: 6,
    שמיני: 7,
    תשיעי: 8,
    עשירי: 9,
  };
  for (const [word, index] of Object.entries(hebrewIndex)) {
    if (new RegExp(`(?:^|[\\s])(?:ה)?${word}(?:\\s|$|[?.!])`, "u").test(text)) {
      return { kind: "index", index };
    }
  }

  const numeric = text.match(/(?:את\s+)?(?:ה)?(?:מספר\s*)?(\d{1,2})(?:\s|$|[?.!])/u);
  if (numeric) {
    const n = Number(numeric[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 20) return { kind: "index", index: n - 1 };
  }

  return null;
}

function parseListedAppointmentFilter(text: string): ListedAppointmentFilter | null {
  const filter: ListedAppointmentFilter = {};

  // Require "יום X" so list ordinals like "הראשון"/"השני" are not treated as weekdays.
  const weekday = text.match(/יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/u);
  if (weekday?.[1]) {
    filter.dayReference = `יום ${weekday[1]}`;
  } else if (/(?:^|\s)מחרתיים(?:\s|$|[?.!])/u.test(text)) {
    filter.dayReference = "מחרתיים";
  } else if (/(?:^|\s)מחר(?:\s|$|[?.!])/u.test(text)) {
    filter.dayReference = "מחר";
  } else if (/(?:^|\s)היום(?:\s|$|[?.!])/u.test(text)) {
    filter.dayReference = "היום";
  }

  const clock = text.match(/(?:^|\s)(\d{1,2}(?::\d{2})?)(?:\s|$|[?.!])/u);
  if (clock?.[1]) {
    const token = clock[1];
    if (/:\d{2}/.test(token) || /(?:ב|בשעה|של)\s+\d{1,2}(?:\s|$|[?.!])/u.test(text)) {
      filter.time = token;
    }
  }

  if (!filter.dayReference && !filter.time) return null;
  return filter;
}

function isBareOrdinalPhrase(text: string): boolean {
  return /^(?:ה)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שביעי|שמיני|תשיעי|עשירי|אחרון|\d{1,2})[.?!]?$/u.test(
    text
  );
}

function isSelectionShapedPhrase(text: string): boolean {
  return (
    /^(?:את\s+)?(?:ה)?תור\s+של\b/u.test(text) ||
    /^(?:של\s+)/u.test(text) ||
    /^(?:התור\s+של\s+)/u.test(text) ||
    /^(?:היום|מחר|מחרתיים|הבוקר|הצהרים|הערב)[.?!]?$/u.test(text) ||
    /^(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)[.?!]?$/u.test(text) ||
    /^(?:\d{1,2}(?::\d{2})?)[.?!]?$/u.test(text) ||
    /^(?:\d{1,2}\s*(?:ב)?(?:יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|ינואר|פברואר|מרץ|אפריל|מאי|יוני))[.?!]?$/u.test(
      text
    )
  );
}

function hasConflictingNonSelectionContent(text: string): boolean {
  return /(?:תבטל|תבטלי|בטל|בטלי|תעביר|תעבירי|תזיז|תזיזי|תשנה|תשני|מה|איזה|מי)\b/u.test(text);
}

/** Cancel/move phrases that select from a prior list by day/time — no customer name. */
function isFilterOnlyCancelOrMove(text: string, kind: "cancel" | "reschedule"): boolean {
  const verb =
    kind === "cancel"
      ? /(?:תבטל|תבטלי|בטל|בטלי)/u
      : /(?:תעביר|תעבירי|תזיז|תזיזי|תשנה|תשני)/u;
  if (!verb.test(text)) return false;
  if (
    /(?:תור|פגישה)?\s*של\s+(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?:\s|$|[?.!])/u.test(
      text
    )
  ) {
    return true;
  }
  if (/(?:תור|פגישה)?\s*של\s+(?:הבוקר|הצהרים|הערב|היום|מחר|מחרתיים)(?:\s|$|[?.!])/u.test(text)) {
    return true;
  }
  if (/(?:תור|פגישה)?\s*של\s+\d{1,2}(?::\d{2})?(?:\s|$|[?.!])/u.test(text)) {
    return true;
  }
  if (
    /(?:תור|פגישה)?\s*של\s+\d{1,2}\s*(?:ב)?(?:יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|ינואר|פברואר|מרץ|אפריל|מאי|יוני)/u.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

function weekdayFromDayReference(dayReference: string): number | null {
  const map: Record<string, number> = {
    ראשון: 0,
    שני: 1,
    שלישי: 2,
    רביעי: 3,
    חמישי: 4,
    שישי: 5,
    שבת: 6,
  };
  for (const [name, day] of Object.entries(map)) {
    if (dayReference.includes(name)) return day;
  }
  return null;
}

function relativeDayOffset(dayReference: string): number | null {
  if (dayReference === "היום") return 0;
  if (dayReference === "מחר") return 1;
  if (dayReference === "מחרתיים") return 2;
  return null;
}

function localWeekday(date: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? 0;
}

function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addLocalDays(date: Date, days: number, _timeZone: string): Date {
  // Approximate: shift by UTC days — sufficient for היום/מחר filters on listed items.
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeTimeLabel(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
