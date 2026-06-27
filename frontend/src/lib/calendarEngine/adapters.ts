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
  client: { id: string; name: string; whatsappNumber?: string | null; color?: string | null };
  service?: { id: string; name: string; color?: string | null; durationMinutes: number } | null;
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

export function buildEndAtIso(startAt: string, durationMinutes: number): string {
  const start = new Date(startAt);
  return new Date(start.getTime() + durationMinutes * 60_000).toISOString();
}
