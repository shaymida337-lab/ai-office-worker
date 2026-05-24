import type { drive_v3 } from "googleapis";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

/** Lazy-load googleapis — avoids 30–60s cold start on Windows */
async function loadGoogle() {
  const { google } = await import("googleapis");
  return google;
}

export async function getGoogleClients(organizationId: string) {
  const google = await loadGoogle();
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "gmail" },
    },
  });
  if (!integration?.refreshToken) {
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

  return {
    gmail: google.gmail({ version: "v1", auth: oauth2 }),
    drive: google.drive({ version: "v3", auth: oauth2 }),
    sheets: google.sheets({ version: "v4", auth: oauth2 }),
    oauth2,
  };
}

export async function getOAuth2Client(redirectUri = config.google.redirectUri) {
  const google = await loadGoogle();
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    redirectUri
  );
}

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
  "openid",
  "email",
  "profile",
];

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
  return created.data.id!;
}
