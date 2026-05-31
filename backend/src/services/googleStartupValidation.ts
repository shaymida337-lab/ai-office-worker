import { prisma } from "../lib/prisma.js";
import { ensureInvoiceFolderTree } from "./driveService.js";
import { getGoogleClients } from "./google.js";
import { ensureSupplierPaymentsSpreadsheet } from "./supplierPaymentsSheet.js";

function publicGoogleError(err: unknown) {
  const candidate = err as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    response?: { status?: unknown; data?: unknown };
    errors?: unknown;
  };
  return JSON.stringify({
    status: candidate.status ?? candidate.code ?? candidate.response?.status ?? null,
    message: err instanceof Error ? err.message : String(candidate.message ?? err),
    data: candidate.response?.data ?? candidate.errors ?? null,
  });
}

export async function validateGoogleIntegrationsAtStartup() {
  const integration = await prisma.integration.findFirst({
    where: {
      provider: "gmail",
      refreshToken: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      organizationId: true,
      accessToken: true,
      refreshToken: true,
    },
  });

  if (!integration?.organizationId) {
    console.warn("[startup/google] SKIP no Gmail OAuth integration with refresh token");
    return;
  }

  console.log(`[startup/google] START organizationId=${integration.organizationId} authMode=oauth_user serviceAccountEmail=none`);

  let clients: Awaited<ReturnType<typeof getGoogleClients>>;
  try {
    clients = await getGoogleClients(integration.organizationId);
    const accessToken = (await clients.oauth2.getAccessToken()).token;
    const tokenInfo = accessToken ? await clients.oauth2.getTokenInfo(accessToken).catch((err) => {
      console.warn(`[startup/google] tokeninfo FAIL organizationId=${integration.organizationId} error=${publicGoogleError(err)}`);
      return null;
    }) : null;
    console.log(
      `[startup/google] auth PASS organizationId=${integration.organizationId} authMode=oauth_user serviceAccountEmail=none principal=${tokenInfo?.email ?? "unknown"} scopes="${tokenInfo?.scopes?.join(" ") ?? "unknown"}"`
    );
  } catch (err) {
    console.error(`[startup/google] auth FAIL organizationId=${integration.organizationId} error=${publicGoogleError(err)}`);
    return;
  }

  try {
    const rootFolderId = await ensureInvoiceFolderTree(clients.drive);
    await clients.drive.files.list({ pageSize: 1, fields: "files(id,name)" });
    console.log(`[startup/google] drive PASS organizationId=${integration.organizationId} rootFolderId=${rootFolderId}`);
  } catch (err) {
    console.error(`[startup/google] drive FAIL organizationId=${integration.organizationId} error=${publicGoogleError(err)}`);
  }

  try {
    const spreadsheet = await ensureSupplierPaymentsSpreadsheet(integration.organizationId);
    await clients.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: "'טבלת חשבוניות חכמה'!A1:Q1",
    });
    console.log(
      `[startup/google] sheets PASS organizationId=${integration.organizationId} spreadsheetId=${spreadsheet.spreadsheetId} spreadsheetUrl=${spreadsheet.spreadsheetUrl}`
    );
  } catch (err) {
    console.error(`[startup/google] sheets FAIL organizationId=${integration.organizationId} error=${publicGoogleError(err)}`);
  }
}
