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

export function buildLastListedAppointmentsPendingAction(
  items: UpcomingSchedulingItem[]
): ConversationSessionRecord["pendingAction"] {
  return {
    action: LAST_LISTED_APPOINTMENTS_ACTION,
    proposal: {
      items: items.map(toListedAppointmentItem),
      listedAt: new Date().toISOString(),
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
 */
export function parseListedAppointmentOrdinalCommand(message: string): {
  intent: "cancel_appointment" | "reschedule_appointment" | "inspect";
  ordinal: ListedAppointmentOrdinal;
  dayReference?: string;
  time?: string;
} | null {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (!normalized) return null;

  const ordinal = parseOrdinalToken(normalized);
  if (!ordinal) return null;

  if (
    /(?:תבטל|תבטלי|בטל|בטלי)\s+(?:את\s+)?(?:ה)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שביעי|שמיני|תשיעי|עשירי|אחרון|\d+)/u.test(
      normalized
    ) ||
    /(?:תבטל|תבטלי|בטל|בטלי)\s+את\s+(?:ה)?(?:ראשון|שני|אחרון)/u.test(normalized)
  ) {
    return { intent: "cancel_appointment", ordinal };
  }

  if (
    /(?:תעביר|תעבירי|תזיז|תזיזי|תשנה|תשני)\s+(?:את\s+)?(?:ה)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שביעי|שמיני|תשיעי|עשירי|אחרון|\d+)/u.test(
      normalized
    )
  ) {
    return { intent: "reschedule_appointment", ordinal };
  }

  if (
    ordinal.kind === "query_last" ||
    /(?:מה|איזה|מי)\s+(?:ה)?(?:ראשון|שני|אחרון)/u.test(normalized)
  ) {
    return { intent: "inspect", ordinal: ordinal.kind === "query_last" ? { kind: "last" } : ordinal };
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

function toListedAppointmentItem(item: UpcomingSchedulingItem): ListedAppointmentItem {
  const start = item.startTime instanceof Date ? item.startTime : new Date(item.startTime);
  const end = new Date(start.getTime() + Math.max(1, item.durationMinutes) * 60_000);
  return {
    appointmentId: item.id,
    source: item.source,
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
