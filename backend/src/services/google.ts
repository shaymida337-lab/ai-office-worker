import type { drive_v3 } from "googleapis";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

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
      data: {
        accessToken: tokens.access_token ?? undefined,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
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

export async function ensureGmailAccessToken(organizationId: string) {
  const google = await loadGoogle();
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "gmail" },
    },
  });
  if (!integration?.refreshToken) {
    throw new Error("Gmail not connected");
  }

  const expiresAt = integration.expiresAt?.getTime() ?? 0;
  const hasValidAccessToken = Boolean(integration.accessToken) && expiresAt > Date.now() + 60_000;
  if (hasValidAccessToken) {
    console.log("Gmail token status: valid");
    return integration;
  }

  console.log("Gmail token status: expired");
  console.log("Gmail token: expired, refreshing...");
  const oauth2 = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
  oauth2.setCredentials({
    refresh_token: integration.refreshToken,
  });

  const { credentials } = await oauth2.refreshAccessToken();
  return prisma.integration.update({
    where: {
      organizationId_provider: { organizationId, provider: "gmail" },
    },
    data: {
      accessToken: credentials.access_token ?? integration.accessToken,
      refreshToken: credentials.refresh_token ?? integration.refreshToken,
      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : integration.expiresAt,
    },
  });
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

export function googleOAuthMetadata(existingMetadata: string | null | undefined, grantedScopeString: string | null | undefined) {
  const existing = parseGoogleIntegrationMetadata(existingMetadata);
  const grantedScopes = grantedScopeString?.split(/\s+/).map((scope) => scope.trim()).filter(Boolean) ?? [];
  return JSON.stringify({
    ...existing,
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

function parseGoogleIntegrationMetadata(metadata: string | null | undefined): Record<string, unknown> {
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
  let integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "google_calendar" },
    },
  });
  if (!integration?.refreshToken) {
    return null;
  }

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
    integration = await prisma.integration.update({
      where: {
        organizationId_provider: { organizationId, provider: "google_calendar" },
      },
      data: {
        accessToken: credentials.access_token ?? integration.accessToken,
        refreshToken: credentials.refresh_token ?? integration.refreshToken,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : integration.expiresAt,
      },
    });
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
      data: {
        accessToken: tokens.access_token ?? undefined,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    });
  });

  return google.calendar({ version: "v3", auth: oauth2 });
}

export async function createGoogleCalendarEventForAppointment(appointment: {
  id: string;
  organizationId: string;
  startTime: Date;
  durationMinutes: number;
  notes?: string | null;
  client?: { name?: string | null } | null;
  service?: { name?: string | null } | null;
}): Promise<string | null> {
  try {
    const calendar = await getCalendarClientForOrganization(appointment.organizationId);
    if (!calendar) {
      return null;
    }

    const clientName = appointment.client?.name?.trim();
    const serviceName = appointment.service?.name?.trim();
    let summary = "תור";
    if (serviceName && clientName) {
      summary = `${serviceName} - ${clientName}`;
    } else if (clientName) {
      summary = `תור - ${clientName}`;
    } else if (serviceName) {
      summary = serviceName;
    }

    const endTime = new Date(appointment.startTime.getTime() + appointment.durationMinutes * 60_000);

    const result = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary,
        description: appointment.notes?.trim() ?? "",
        start: {
          dateTime: appointment.startTime.toISOString(),
          timeZone: "Asia/Jerusalem",
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: "Asia/Jerusalem",
        },
      },
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

export async function getGoogleClientsForClient(clientId: string) {
  const google = await loadGoogle();
  const client = await prisma.client.findUnique({ where: { id: clientId } });
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
      data: {
        googleAccessToken: tokens.access_token ?? undefined,
        ...(tokens.refresh_token && { googleRefreshToken: tokens.refresh_token }),
      },
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
