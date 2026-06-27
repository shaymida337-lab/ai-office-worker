export type CalendarEngineGoogleMirrorSource = {
  clientName?: string | null;
  serviceName?: string | null;
  title?: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  locationType?: string | null;
  address?: string | null;
  internalNotes?: string | null;
  completionNotes?: string | null;
  prerequisitesJson?: unknown;
};

export type CalendarEngineGoogleEventBody = {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
};

export const CALENDAR_ENGINE_GOOGLE_DESCRIPTION = "נוצר על ידי נטלי";

export function buildCalendarEngineGoogleEventSummary(source: CalendarEngineGoogleMirrorSource): string {
  const clientName = source.clientName?.trim() || source.title?.trim() || "תור";
  const serviceName = source.serviceName?.trim() || "תור";
  return `${clientName} — ${serviceName}`;
}

export function resolvePublicGoogleLocation(
  locationType?: string | null,
  address?: string | null
): string | undefined {
  if (locationType === "remote") {
    return undefined;
  }
  const trimmed = address?.trim();
  return trimmed || undefined;
}

export function buildCalendarEngineGoogleEventBody(
  source: CalendarEngineGoogleMirrorSource
): CalendarEngineGoogleEventBody {
  const timeZone = source.timezone?.trim() || "Asia/Jerusalem";
  const location = resolvePublicGoogleLocation(source.locationType, source.address);

  return {
    summary: buildCalendarEngineGoogleEventSummary(source),
    description: CALENDAR_ENGINE_GOOGLE_DESCRIPTION,
    ...(location ? { location } : {}),
    start: {
      dateTime: source.startAt.toISOString(),
      timeZone,
    },
    end: {
      dateTime: source.endAt.toISOString(),
      timeZone,
    },
  };
}

/** Test helper — ensures no internal fields leak into outbound Google payload. */
export function assertSafeCalendarEngineGooglePayload(body: CalendarEngineGoogleEventBody): void {
  const serialized = JSON.stringify(body);
  const forbidden = ["internalNotes", "prerequisite", "payment", "invoice", "audit", "timeline"];
  for (const token of forbidden) {
    if (serialized.toLowerCase().includes(token.toLowerCase())) {
      throw new Error(`Unsafe Google payload contains forbidden token: ${token}`);
    }
  }
  if (body.description !== CALENDAR_ENGINE_GOOGLE_DESCRIPTION) {
    throw new Error("Google description must use minimal safe text only");
  }
}
