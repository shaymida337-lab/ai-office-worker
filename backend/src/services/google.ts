import type { drive_v3 } from "googleapis";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import {
  decryptClientGoogleTokens,
  decryptIntegrationTokens,
  encryptClientGoogleTokens,
  encryptIntegrationTokens,
} from "../lib/integrationSecrets.js";
import {
  assertGmailIntegrationIsolatedForScan,
  assertIntegrationBelongsToOrganization,
} from "./gmailIntegrationIsolation.js";

type ScopeAwareOAuth2Client = {
  getAccessToken(): Promise<{ token?: string | null } | string | null | undefined>;
  getTokenInfo(accessToken: string): Promise<{ scopes?: string[] }>;
};

/** Lazy-load googleapis — avoids 30–60s cold start on Windows */
async function loadGoogle() {
  const { google } = await import("googleapis");
  return google;
}

export async function getGoogleClients(organizationId: string) {
  const google = await loadGoogle();
  const integration = await ensureGmailAccessToken(organizationId);
  assertIntegrationBelongsToOrganization(integration, organizationId);
  if (!integration.refreshToken) {
    throw new Error("Gmail not connected");
  }

  const oauth2 = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
  oauth2.setCredentials({
    access_token: integration.accessToken ?? undefined,
    refresh_token: integration.refreshToken,
    expiry_date: integration.expiresAt?.getTime(),
  });

  oauth2.on("tokens", async (tokens) => {
    await prisma.integration.update({
      where: {
        organizationId_provider: { organizationId, provider: "gmail" },
      },
      data: encryptIntegrationTokens({
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
      }),
    });
  });

  await assertRequiredGoogleDriveScopes(oauth2, { organizationId, context: "organization_google_clients" });

  return {
    gmail: google.gmail({ version: "v1", auth: oauth2 }),
    drive: google.drive({ version: "v3", auth: oauth2 }),
    sheets: google.sheets({ version: "v4", auth: oauth2 }),
    oauth2,
  };
}

export type GoogleClients = Awaited<ReturnType<typeof getGoogleClients>>;

export async function getGoogleClientsIfAvailable(
  organizationId: string,
  context = "optional_google_clients"
): Promise<GoogleClients | null> {
  try {
    return await getGoogleClients(organizationId);
  } catch (err) {
    console.warn(JSON.stringify({
      event: "google_clients_unavailable",
      organizationId,
      context,
      reason: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

export async function ensureGmailAccessToken(organizationId: string) {
  const google = await loadGoogle();
  const rawIntegration = await assertGmailIntegrationIsolatedForScan(organizationId);
  const integration = decryptIntegrationTokens(rawIntegration);

  const expiresAt = integration.expiresAt?.getTime() ?? 0;
  const hasValidAccessToken = Boolean(integration.accessToken) && expiresAt > Date.now() + 60_000;
  if (hasValidAccessToken) {
    return integration;
  }

  const oauth2 = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
  oauth2.setCredentials({
    refresh_token: integration.refreshToken,
  });

  const { credentials } = await oauth2.refreshAccessToken();
  const updated = await prisma.integration.update({
    where: {
      organizationId_provider: { organizationId, provider: "gmail" },
    },
    data: {
      ...encryptIntegrationTokens({
        accessToken: credentials.access_token ?? integration.accessToken,
        refreshToken: credentials.refresh_token ?? integration.refreshToken,
      }),
      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : integration.expiresAt,
    },
  });
  return decryptIntegrationTokens(updated);
}

export async function getOAuth2Client(redirectUri = config.google.redirectUri) {
  const google = await loadGoogle();
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    redirectUri
  );
}

export const REQUIRED_GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
];

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
  ...REQUIRED_GOOGLE_DRIVE_SCOPES,
  "https://www.googleapis.com/auth/spreadsheets",
  "openid",
  "email",
  "profile",
];

export const CALENDAR_SCOPES = [
  ...GMAIL_SCOPES,
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar",
];

type OutboundEmailContext = {
  provider: "gmail";
  feature: string;
  organizationId?: string;
  clientId?: string;
  recipientDomain?: string;
};

export function isOutboundEmailAllowed() {
  return config.outboundEmail.allowSend;
}

export function assertOutboundEmailAllowed(context: OutboundEmailContext) {
  if (isOutboundEmailAllowed()) return;

  const safeContext = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== "")
  );
  console.warn(`SECURITY_EMAIL_SEND_ATTEMPT_BLOCKED ${JSON.stringify(safeContext)}`);
  const error = new Error("Outbound email sending is disabled.");
  (error as Error & { code?: string }).code = "OUTBOUND_EMAIL_SEND_BLOCKED";
  throw error;
}

export function missingRequiredGoogleDriveScopes(scopes: readonly string[] | null | undefined) {
  const granted = new Set(scopes ?? []);
  return REQUIRED_GOOGLE_DRIVE_SCOPES.filter((scope) => !granted.has(scope));
}

export function googleOAuthMetadata(
  existingMetadata: string | null | undefined,
  grantedScopeString: string | null | undefined,
  googleAccountEmail?: string | null
) {
  const existing = parseGoogleIntegrationMetadata(existingMetadata);
  const parsedScopes = grantedScopeString?.split(/\s+/).map((scope) => scope.trim()).filter(Boolean) ?? [];
  const existingScopes = Array.isArray(existing.googleOAuthScopes)
    ? existing.googleOAuthScopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  // תשובת הטוקן של גוגל לא תמיד כוללת scope (בעיקר בחיבור-מחדש בלי הסכמה
  // חדשה). קלט ריק/חסר משמר את ה-scopes הידועים במקום למחוק אותם — מחיקה
  // הדליקה reconnectRequired שווא לצמיתות אחרי reconnect מוצלח. תשובה עם
  // scope בפועל עדיין דורסת במלואה (כולל צמצום הרשאות אמיתי).
  const grantedScopes = parsedScopes.length > 0 ? parsedScopes : existingScopes;
  const normalizedEmail =
    typeof googleAccountEmail === "string" ? googleAccountEmail.trim().toLowerCase() : null;
  return JSON.stringify({
    ...existing,
    ...(normalizedEmail ? { googleAccountEmail: normalizedEmail } : {}),
    googleOAuthScopes: grantedScopes,
    googleDriveRequiredScopes: REQUIRED_GOOGLE_DRIVE_SCOPES,
    googleOAuthScopesUpdatedAt: new Date().toISOString(),
  });
}

export function googleOAuthScopesFromMetadata(metadata: string | null | undefined) {
  const parsed = parseGoogleIntegrationMetadata(metadata);
  return Array.isArray(parsed.googleOAuthScopes)
    ? parsed.googleOAuthScopes.filter((scope): scope is string => typeof scope === "string")
    : [];
}

export function isGoogleReconnectRequiredError(err: unknown) {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "GOOGLE_RECONNECT_REQUIRED");
}

export async function assertRequiredGoogleDriveScopes(
  oauth2: ScopeAwareOAuth2Client,
  input: { organizationId?: string; clientId?: string; context: string }
) {
  const accessTokenResult = await oauth2.getAccessToken();
  const accessToken = typeof accessTokenResult === "string" ? accessTokenResult : accessTokenResult?.token;
  if (!accessToken) {
    const error = new Error("Google OAuth access token is unavailable. Reconnect Google integration.");
    (error as Error & { code?: string }).code = "GOOGLE_RECONNECT_REQUIRED";
    throw error;
  }

  const tokenInfo = await oauth2.getTokenInfo(accessToken);
  const scopes = tokenInfo.scopes ?? [];
  const missingScopes = missingRequiredGoogleDriveScopes(scopes);
  if (missingScopes.length === 0) return scopes;

  console.warn(
    `[google/oauth] missing required Drive scopes context=${input.context} org=${input.organizationId ?? "none"} client=${input.clientId ?? "none"} missing="${missingScopes.join(" ")}" granted="${scopes.join(" ")}"`
  );
  const error = new Error(
    `Google Drive permissions are missing required scopes (${missingScopes.join(", ")}). Reconnect Google integration from Settings.`
  );
  (error as Error & { code?: string; missingScopes?: string[]; grantedScopes?: string[] }).code = "GOOGLE_RECONNECT_REQUIRED";
  (error as Error & { missingScopes?: string[] }).missingScopes = missingScopes;
  (error as Error & { grantedScopes?: string[] }).grantedScopes = scopes;
  throw error;
}

export function parseGoogleIntegrationMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function getCalendarClientForOrganization(organizationId: string) {
  const google = await loadGoogle();
  const rawIntegration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "google_calendar" },
    },
  });
  if (!rawIntegration?.refreshToken) {
    return null;
  }
  let integration = decryptIntegrationTokens(rawIntegration);

  const expiresAt = integration.expiresAt?.getTime() ?? 0;
  const hasValidAccessToken = Boolean(integration.accessToken) && expiresAt > Date.now() + 60_000;
  if (!hasValidAccessToken) {
    const oauth2Refresh = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.calendarRedirectUri
    );
    oauth2Refresh.setCredentials({
      refresh_token: integration.refreshToken,
    });
    const { credentials } = await oauth2Refresh.refreshAccessToken();
    const updated = await prisma.integration.update({
      where: {
        organizationId_provider: { organizationId, provider: "google_calendar" },
      },
      data: {
        ...encryptIntegrationTokens({
          accessToken: credentials.access_token ?? integration.accessToken,
          refreshToken: credentials.refresh_token ?? integration.refreshToken,
        }),
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : integration.expiresAt,
      },
    });
    integration = decryptIntegrationTokens(updated);
  }

  const oauth2 = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.calendarRedirectUri
  );
  oauth2.setCredentials({
    access_token: integration.accessToken ?? undefined,
    refresh_token: integration.refreshToken,
    expiry_date: integration.expiresAt?.getTime(),
  });

  oauth2.on("tokens", async (tokens) => {
    await prisma.integration.update({
      where: {
        organizationId_provider: { organizationId, provider: "google_calendar" },
      },
      data: encryptIntegrationTokens({
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
      }),
    });
  });

  return google.calendar({ version: "v3", auth: oauth2 });
}

type AppointmentCalendarPayload = {
  id: string;
  organizationId: string;
  startTime: Date;
  durationMinutes: number;
  notes?: string | null;
  client?: { name?: string | null } | null;
  service?: { name?: string | null } | null;
};

export class GoogleCalendarSyncError extends Error {
  readonly code:
    | "calendar_disabled"
    | "google_not_found"
    | "google_api_error";
  readonly statusCode?: number;

  constructor(
    code: "calendar_disabled" | "google_not_found" | "google_api_error",
    message: string,
    statusCode?: number
  ) {
    super(message);
    this.name = "GoogleCalendarSyncError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function buildAppointmentEventSummary(
  appointment: Pick<AppointmentCalendarPayload, "client" | "service">
): string {
  const clientName = appointment.client?.name?.trim();
  const serviceName = appointment.service?.name?.trim();
  if (serviceName && clientName) {
    return `${serviceName} - ${clientName}`;
  }
  if (clientName) {
    return `תור - ${clientName}`;
  }
  if (serviceName) {
    return serviceName;
  }
  return "תור";
}

function buildAppointmentEventRequestBody(appointment: AppointmentCalendarPayload) {
  const endTime = new Date(appointment.startTime.getTime() + appointment.durationMinutes * 60_000);
  return {
    summary: buildAppointmentEventSummary(appointment),
    description: appointment.notes?.trim() ?? "",
    start: {
      dateTime: appointment.startTime.toISOString(),
      timeZone: "Asia/Jerusalem",
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: "Asia/Jerusalem",
    },
  };
}

function isGoogleCalendarEventNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { code?: number; status?: number; response?: { status?: number } };
  const status = candidate.code ?? candidate.status ?? candidate.response?.status;
  return status === 404 || status === 410;
}

function googleErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const candidate = err as { code?: number; status?: number; response?: { status?: number } };
  return candidate.code ?? candidate.status ?? candidate.response?.status;
}

export async function upsertGoogleCalendarEventForAppointmentStrict(
  appointment: AppointmentCalendarPayload & { googleEventId?: string | null }
): Promise<string> {
  const calendar = await getCalendarClientForOrganization(appointment.organizationId);
  if (!calendar) {
    throw new GoogleCalendarSyncError(
      "calendar_disabled",
      "Google Calendar integration is not connected for organization"
    );
  }

  try {
    if (appointment.googleEventId) {
      await calendar.events.update({
        calendarId: "primary",
        eventId: appointment.googleEventId,
        requestBody: buildAppointmentEventRequestBody(appointment),
      });
      return appointment.googleEventId;
    }

    const created = await calendar.events.insert({
      calendarId: "primary",
      requestBody: buildAppointmentEventRequestBody(appointment),
    });
    const newId = created.data.id ?? null;
    if (!newId) {
      throw new GoogleCalendarSyncError("google_api_error", "Google Calendar did not return an event id");
    }
    return newId;
  } catch (err) {
    const status = googleErrorStatus(err);
    if (status === 404 || status === 410) {
      throw new GoogleCalendarSyncError("google_not_found", "Google Calendar event not found", status);
    }
    throw new GoogleCalendarSyncError(
      "google_api_error",
      err instanceof Error ? err.message : "Unknown Google Calendar API error",
      status
    );
  }
}

export async function deleteGoogleCalendarEventForAppointmentStrict(
  organizationId: string,
  googleEventId: string
): Promise<void> {
  const calendar = await getCalendarClientForOrganization(organizationId);
  if (!calendar) {
    throw new GoogleCalendarSyncError(
      "calendar_disabled",
      "Google Calendar integration is not connected for organization"
    );
  }

  try {
    await calendar.events.delete({
      calendarId: "primary",
      eventId: googleEventId,
    });
  } catch (err) {
    const status = googleErrorStatus(err);
    if (status === 404 || status === 410) return;
    throw new GoogleCalendarSyncError(
      "google_api_error",
      err instanceof Error ? err.message : "Unknown Google Calendar API error",
      status
    );
  }
}

export async function createGoogleCalendarEventForAppointment(
  appointment: AppointmentCalendarPayload
): Promise<string | null> {
  try {
    const calendar = await getCalendarClientForOrganization(appointment.organizationId);
    if (!calendar) {
      return null;
    }

    const result = await calendar.events.insert({
      calendarId: "primary",
      requestBody: buildAppointmentEventRequestBody(appointment),
    });

    return result.data.id ?? null;
  } catch (err) {
    console.error(
      `[google/calendar] Failed to create event for appointment ${appointment.id}`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function updateGoogleCalendarEventForAppointment(
  appointment: AppointmentCalendarPayload & { googleEventId: string }
): Promise<boolean> {
  try {
    const calendar = await getCalendarClientForOrganization(appointment.organizationId);
    if (!calendar || !appointment.googleEventId) {
      return false;
    }

    await calendar.events.update({
      calendarId: "primary",
      eventId: appointment.googleEventId,
      requestBody: buildAppointmentEventRequestBody(appointment),
    });

    return true;
  } catch (err) {
    console.error(
      `[google/calendar] Failed to update event for appointment ${appointment.id}`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export async function deleteGoogleCalendarEventForAppointment(
  organizationId: string,
  googleEventId: string
): Promise<boolean> {
  try {
    const calendar = await getCalendarClientForOrganization(organizationId);
    if (!calendar || !googleEventId) {
      return false;
    }

    await calendar.events.delete({
      calendarId: "primary",
      eventId: googleEventId,
    });

    return true;
  } catch (err) {
    if (isGoogleCalendarEventNotFoundError(err)) {
      return true;
    }
    console.error(
      `[google/calendar] Failed to delete event ${googleEventId} for organization ${organizationId}`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export type CalendarEngineGoogleEventPayload = {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
};

export async function insertCalendarEngineGoogleEvent(
  organizationId: string,
  requestBody: CalendarEngineGoogleEventPayload
): Promise<string | null> {
  try {
    const calendar = await getCalendarClientForOrganization(organizationId);
    if (!calendar) {
      return null;
    }

    const result = await calendar.events.insert({
      calendarId: "primary",
      requestBody,
    });

    return result.data.id ?? null;
  } catch (err) {
    console.error(
      `[google/calendar-engine] Failed to create event for organization ${organizationId}`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function updateCalendarEngineGoogleEvent(
  organizationId: string,
  googleEventId: string,
  requestBody: CalendarEngineGoogleEventPayload
): Promise<boolean> {
  try {
    const calendar = await getCalendarClientForOrganization(organizationId);
    if (!calendar || !googleEventId) {
      return false;
    }

    await calendar.events.update({
      calendarId: "primary",
      eventId: googleEventId,
      requestBody,
    });

    return true;
  } catch (err) {
    console.error(
      `[google/calendar-engine] Failed to update event ${googleEventId} for organization ${organizationId}`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export async function deleteCalendarEngineGoogleEvent(
  organizationId: string,
  googleEventId: string
): Promise<boolean> {
  try {
    const calendar = await getCalendarClientForOrganization(organizationId);
    if (!calendar || !googleEventId) {
      return false;
    }

    await calendar.events.delete({
      calendarId: "primary",
      eventId: googleEventId,
    });

    return true;
  } catch (err) {
    if (isGoogleCalendarEventNotFoundError(err)) {
      return true;
    }
    console.error(
      `[google/calendar-engine] Failed to delete event ${googleEventId} for organization ${organizationId}`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/** Read-through Google busy / list rows — never written permanently to DB by this helper. */
export type GoogleCalendarReadEvent = {
  googleEventId: string;
  summary: string;
  start: Date;
  end: Date;
  status: string | null;
};

export type GoogleCalendarReadResult =
  | { ok: true; events: GoogleCalendarReadEvent[]; calendarId: string }
  | {
      ok: false;
      reason: "not_connected" | "permission_denied" | "api_error";
      messageHe: string;
    };

const GOOGLE_CALENDAR_READ_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

export function hasGoogleCalendarReadScopes(scopes: readonly string[] | null | undefined): boolean {
  const granted = new Set(scopes ?? []);
  return GOOGLE_CALENDAR_READ_SCOPES.some((scope) => granted.has(scope));
}

function parseGoogleEventDateTime(value: { dateTime?: string | null; date?: string | null } | null | undefined): Date | null {
  if (!value) return null;
  if (value.dateTime) {
    const parsed = new Date(value.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value.date) {
    // All-day events: treat as [date 00:00, next day 00:00) UTC for busy blocking.
    const parsed = new Date(`${value.date}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Safe inbound Google Calendar read for Natalie availability / list.
 * Does not persist events. Returns an honest Hebrew failure reason when
 * the org is disconnected or lacks read permission — never "empty calendar".
 */
export async function listGoogleCalendarEventsInRange(
  organizationId: string,
  range: { start: Date; end: Date }
): Promise<GoogleCalendarReadResult> {
  try {
    const rawIntegration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "google_calendar" },
      },
      select: { refreshToken: true, metadata: true },
    });
    if (!rawIntegration?.refreshToken) {
      return {
        ok: false,
        reason: "not_connected",
        messageHe: "אין חיבור ל-Google Calendar, אז אני לא יכולה לראות אירועים שנוצרו שם ישירות.",
      };
    }

    const scopes = googleOAuthScopesFromMetadata(rawIntegration.metadata);
    // Older connections may omit scopes metadata while still holding calendar write tokens.
    // Only hard-fail on explicit empty/known-missing when scopes were recorded.
    if (scopes.length > 0 && !hasGoogleCalendarReadScopes(scopes)) {
      return {
        ok: false,
        reason: "permission_denied",
        messageHe:
          "אין לי הרשאה לקרוא את Google Calendar. חברי מחדש את היומן בהגדרות כדי שאוכל לראות תורים שנוצרו שם.",
      };
    }

    const calendar = await getCalendarClientForOrganization(organizationId);
    if (!calendar) {
      return {
        ok: false,
        reason: "not_connected",
        messageHe: "אין חיבור ל-Google Calendar, אז אני לא יכולה לראות אירועים שנוצרו שם ישירות.",
      };
    }

    const metadata = parseGoogleIntegrationMetadata(rawIntegration.metadata);
    const calendarId =
      typeof metadata.calendarId === "string" && metadata.calendarId.trim()
        ? metadata.calendarId.trim()
        : "primary";

    const events: GoogleCalendarReadEvent[] = [];
    let pageToken: string | undefined;
    do {
      const response = await calendar.events.list({
        calendarId,
        timeMin: range.start.toISOString(),
        timeMax: range.end.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });

      for (const item of response.data.items ?? []) {
        if (!item?.id) continue;
        if (item.status === "cancelled") continue;
        if (item.transparency === "transparent") continue;

        const start = parseGoogleEventDateTime(item.start);
        let end = parseGoogleEventDateTime(item.end);
        if (!start) continue;
        if (!end) {
          // All-day with only start date: block one day.
          end = new Date(start.getTime() + 24 * 60 * 60_000);
        }
        if (end.getTime() <= range.start.getTime()) continue;
        if (start.getTime() >= range.end.getTime()) continue;

        events.push({
          googleEventId: item.id,
          summary: (item.summary ?? "").trim() || "אירוע ב-Google Calendar",
          start,
          end,
          status: item.status ?? null,
        });
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return { ok: true, events, calendarId };
  } catch (err) {
    const status = googleErrorStatus(err);
    if (status === 401 || status === 403) {
      console.warn(
        `[google/calendar] read permission denied org=${organizationId} status=${status}`,
        err instanceof Error ? err.message : err
      );
      return {
        ok: false,
        reason: "permission_denied",
        messageHe:
          "אין לי הרשאה לקרוא את Google Calendar. חברי מחדש את היומן בהגדרות כדי שאוכל לראות תורים שנוצרו שם.",
      };
    }
    console.error(
      `[google/calendar] Failed to list events for organization ${organizationId}`,
      err instanceof Error ? err.message : err
    );
    return {
      ok: false,
      reason: "api_error",
      messageHe: "לא הצלחתי לקרוא את Google Calendar כרגע, אז הרשימה עלולה להיות חלקית.",
    };
  }
}

export async function getGoogleClientsForClient(clientId: string) {
  const google = await loadGoogle();
  const rawClient = await prisma.client.findUnique({ where: { id: clientId } });
  const client = rawClient ? decryptClientGoogleTokens(rawClient) : null;
  if (!client?.googleRefreshToken) {
    throw new Error("Client Gmail not connected");
  }

  const oauth2 = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.clientGmailRedirectUri
  );
  oauth2.setCredentials({
    access_token: client.googleAccessToken ?? undefined,
    refresh_token: client.googleRefreshToken,
  });

  oauth2.on("tokens", async (tokens) => {
    await prisma.client.update({
      where: { id: clientId },
      data: encryptClientGoogleTokens({
        googleAccessToken: tokens.access_token ?? undefined,
        googleRefreshToken: tokens.refresh_token ?? undefined,
      }),
    });
  });

  await assertRequiredGoogleDriveScopes(oauth2, { organizationId: client.organizationId, clientId, context: "client_google_clients" });

  return {
    gmail: google.gmail({ version: "v1", auth: oauth2 }),
    drive: google.drive({ version: "v3", auth: oauth2 }),
    sheets: google.sheets({ version: "v4", auth: oauth2 }),
    oauth2,
    client,
  };
}

export async function ensureDriveFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string
): Promise<string> {
  const q = parentId
    ? `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const existing = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  if (existing.data.files?.[0]?.id) return existing.data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  console.log(
    `[drive] DRIVE_FOLDER_CREATED name="${name}" folderId=${created.data.id ?? "none"} parentId=${parentId ?? "root"}`
  );
  return created.data.id!;
}
