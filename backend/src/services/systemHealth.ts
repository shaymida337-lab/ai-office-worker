import { prisma } from "../lib/prisma.js";
import { getGoogleClients } from "./google.js";
import { ensureInvoiceFolderTree } from "./driveService.js";
import { ensureSupplierPaymentsSpreadsheet } from "./supplierPaymentsSheet.js";
import { getWhatsAppSettings } from "./whatsapp.js";

type ComponentName = "gmail" | "drive" | "sheets" | "whatsapp" | "database";

export type SystemComponentStatus = {
  name: ComponentName;
  label: string;
  connected: boolean;
  status: "PASS" | "FAIL";
  reason: string | null;
  details?: Record<string, unknown>;
};

function publicError(err: unknown) {
  const candidate = err as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    response?: { status?: unknown; data?: unknown };
    errors?: unknown;
  };
  const message = err instanceof Error ? err.message : String(candidate.message ?? err);
  const status = candidate.status ?? candidate.code ?? candidate.response?.status ?? null;
  return status ? `${message} (status ${String(status)})` : message;
}

function pass(name: ComponentName, label: string, details?: Record<string, unknown>): SystemComponentStatus {
  return { name, label, connected: true, status: "PASS", reason: null, details };
}

function fail(name: ComponentName, label: string, reason: string, details?: Record<string, unknown>): SystemComponentStatus {
  return { name, label, connected: false, status: "FAIL", reason, details };
}

export async function getSystemHealth(organizationId: string) {
  const database = await checkDatabase();
  const gmail = await checkGmail(organizationId);
  const [drive, sheets, whatsapp] = await Promise.all([
    checkDrive(organizationId),
    checkSheets(organizationId),
    checkWhatsApp(organizationId),
  ]);

  const components = { gmail, drive, sheets, whatsapp, database };
  return {
    checkedAt: new Date().toISOString(),
    components,
    allPassed: Object.values(components).every((component) => component.connected),
  };
}

async function checkDatabase(): Promise<SystemComponentStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return pass("database", "Database");
  } catch (err) {
    return fail("database", "Database", publicError(err));
  }
}

async function checkGmail(organizationId: string): Promise<SystemComponentStatus> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "gmail" } },
    select: { refreshToken: true, connectedAt: true },
  });
  if (!integration?.refreshToken) {
    return fail("gmail", "Gmail", "Gmail OAuth is not connected");
  }

  try {
    const { oauth2 } = await getGoogleClients(organizationId);
    const accessToken = (await oauth2.getAccessToken()).token;
    const tokenInfo = accessToken ? await oauth2.getTokenInfo(accessToken) : null;
    const scopes = tokenInfo?.scopes ?? [];
    const hasGmailScope = scopes.some((scope) => scope.includes("gmail"));
    if (!hasGmailScope) {
      return fail("gmail", "Gmail", "Google token is missing Gmail scopes", { scopes });
    }
    return pass("gmail", "Gmail", {
      principal: tokenInfo?.email ?? null,
      connectedAt: integration.connectedAt,
    });
  } catch (err) {
    return fail("gmail", "Gmail", publicError(err));
  }
}

async function checkDrive(organizationId: string): Promise<SystemComponentStatus> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "gmail" } },
    select: { refreshToken: true },
  });
  if (!integration?.refreshToken) {
    return fail("drive", "Google Drive", "Gmail OAuth is required for Drive access");
  }

  try {
    const { drive } = await getGoogleClients(organizationId);
    const rootFolderId = await ensureInvoiceFolderTree(drive);
    await drive.files.list({ pageSize: 1, fields: "files(id,name)" });
    return pass("drive", "Google Drive", { rootFolderId });
  } catch (err) {
    return fail("drive", "Google Drive", publicError(err));
  }
}

async function checkSheets(organizationId: string): Promise<SystemComponentStatus> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "gmail" } },
    select: { refreshToken: true },
  });
  if (!integration?.refreshToken) {
    return fail("sheets", "Google Sheets", "Gmail OAuth is required for Sheets access");
  }

  try {
    const { sheets } = await getGoogleClients(organizationId);
    const spreadsheet = await ensureSupplierPaymentsSpreadsheet(organizationId);
    await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: "'טבלת חשבוניות חכמה'!A1:Q1",
    });
    return pass("sheets", "Google Sheets", {
      spreadsheetId: spreadsheet.spreadsheetId,
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
    });
  } catch (err) {
    return fail("sheets", "Google Sheets", publicError(err));
  }
}

async function checkWhatsApp(organizationId: string): Promise<SystemComponentStatus> {
  try {
    const settings = await getWhatsAppSettings(organizationId);
    if (!settings.configured) {
      return fail("whatsapp", "WhatsApp", "Twilio WhatsApp environment variables are missing", {
        webhookUrl: settings.webhookUrl,
      });
    }
    if (!settings.connected) {
      return fail("whatsapp", "WhatsApp", "Twilio account connection check failed", {
        webhookUrl: settings.webhookUrl,
        from: settings.from,
      });
    }
    if (!settings.ownerWhatsApp) {
      return fail("whatsapp", "WhatsApp", "Owner WhatsApp number is not configured", {
        webhookUrl: settings.webhookUrl,
        from: settings.from,
      });
    }
    return pass("whatsapp", "WhatsApp", {
      ownerWhatsApp: settings.ownerWhatsApp,
      from: settings.from,
      webhookUrl: settings.webhookUrl,
      connectedAt: settings.connectedAt,
    });
  } catch (err) {
    return fail("whatsapp", "WhatsApp", publicError(err));
  }
}
