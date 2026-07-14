import type { CalendarEngineEvent } from "./types";

/** Appointment-shaped item for existing calendar views, tagged with engine metadata. */
export type CalendarDisplayItem = {
  id: string;
  clientId: string;
  serviceId?: string | null;
  startTime: string;
  durationMinutes: number;
  status: string;
  notes?: string | null;
  client: {
    id: string;
    name: string;
    whatsappNumber?: string | null;
    phone?: string | null;
    email?: string | null;
    emailIsPlaceholder?: boolean | null;
    address?: string | null;
    color?: string | null;
  };
  service?: { id: string; name: string; color?: string | null; durationMinutes: number } | null;
  /** Calendar Phase 1: תור של עובד; חסר/null = היומן של בעל העסק */
  employeeId?: string | null;
  employee?: { id: string; name: string; color?: string | null; isActive?: boolean } | null;
  source: "appointment" | "calendar_engine";
  engineEventId?: string;
  workCaseId?: string;
};

export function durationMinutesFromRange(startAt: string, endAt: string): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const minutes = Math.round((end - start) / 60_000);
  return minutes > 0 ? minutes : 30;
}

export function calendarEventToDisplayItem(event: CalendarEngineEvent): CalendarDisplayItem {
  const client = event.client ?? { id: event.clientId ?? "", name: event.title?.trim() || "ללא שם" };
  return {
    id: event.id,
    clientId: event.clientId ?? client.id,
    serviceId: event.serviceId ?? null,
    startTime: event.startAt,
    durationMinutes: event.service?.durationMinutes ?? durationMinutesFromRange(event.startAt, event.endAt),
    status: event.status,
    notes: null,
    client: { id: client.id, name: client.name },
    service: event.service
      ? {
          id: event.service.id,
          name: event.service.name,
          durationMinutes: event.service.durationMinutes,
          color: null,
        }
      : null,
    source: "calendar_engine",
    engineEventId: event.id,
    workCaseId: event.workCaseId,
  };
}

export function calendarEventsToDisplayItems(events: CalendarEngineEvent[]): CalendarDisplayItem[] {
  return events.map(calendarEventToDisplayItem);
}

export function isEngineDisplayItem(item: CalendarDisplayItem): boolean {
  return item.source === "calendar_engine";
}

const NAIVE_START_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function buildEndAtIso(startAt: string, durationMinutes: number): string {
  const naive = startAt.match(NAIVE_START_REGEX);
  if (naive) {
    // startAt נאיבי: חשבון שעון-קיר טהור (Date.UTC בלי אזור הדפדפן) כדי
    // שה-endAt יישאר נאיבי וה-backend יגזור את המשך מהפרש שתי המחרוזות.
    const end = new Date(
      Date.UTC(
        Number(naive[1]),
        Number(naive[2]) - 1,
        Number(naive[3]),
        Number(naive[4]),
        Number(naive[5])
      ) + durationMinutes * 60_000
    );
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}T${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`;
  }
  const start = new Date(startAt);
  return new Date(start.getTime() + durationMinutes * 60_000).toISOString();
}
