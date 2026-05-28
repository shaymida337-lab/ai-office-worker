import { prisma } from "../lib/prisma.js";
import { getGoogleClients } from "./google.js";

const SHEET_TITLE = "Supplier Payments";
const HEADERS = ["supplier", "amount", "dueDate", "paid", "invoiceLink", "gmailLink", "status"];

type SheetMetadata = {
  supplierPaymentsSpreadsheetId?: string;
  supplierPaymentsSpreadsheetUrl?: string;
};

export async function appendSupplierPaymentToSheet(input: {
  organizationId: string;
  paymentId?: string;
  supplier: string;
  date: Date;
  dueDate?: Date | null;
  amount: number;
  paid: boolean;
  missingInvoice: boolean;
  documentLink?: string | null;
  invoiceLink?: string | null;
  gmailLink?: string | null;
}) {
  const { sheets } = await getGoogleClients(input.organizationId);
  const spreadsheet = await ensureSupplierPaymentsSpreadsheet(input.organizationId);
  await ensureHeaders(input.organizationId, spreadsheet.spreadsheetId);

  const status = input.paid ? "paid" : input.missingInvoice ? "missing_invoice" : "pending";
  const dueDateValue = (input.dueDate ?? input.date).toISOString().slice(0, 10);
  const values = [
    input.supplier,
    input.amount,
    dueDateValue,
    input.paid ? "TRUE" : "FALSE",
    input.invoiceLink ?? "",
    input.gmailLink ?? input.documentLink ?? "",
    status,
  ];
  const row = await findSupplierPaymentRow(input.organizationId, spreadsheet.spreadsheetId, {
    gmailLink: input.gmailLink ?? input.documentLink ?? null,
    supplier: input.supplier,
    amount: input.amount,
    dueDate: dueDateValue,
  });

  if (row) {
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: `${SHEET_TITLE}!A${row}:G${row}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [values] },
      }),
      `[sheets] update supplier payment row=${row}`
    );
    return { ...spreadsheet, row, updated: true };
  }

  const append = await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: `${SHEET_TITLE}!A:G`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    }),
    "[sheets] append supplier payment"
  );

  const rowNumber = Number(append.data.updates?.updatedRange?.match(/![A-Z]+(\d+):/)?.[1] ?? 0) || null;
  return { ...spreadsheet, row: rowNumber, updated: false };
}

async function ensureSupplierPaymentsSpreadsheet(organizationId: string) {
  const { sheets } = await getGoogleClients(organizationId);
  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "sheets" } },
  });
  const metadata = parseMetadata(existing?.metadata);
  if (metadata.supplierPaymentsSpreadsheetId) {
    return {
      spreadsheetId: metadata.supplierPaymentsSpreadsheetId,
      spreadsheetUrl:
        metadata.supplierPaymentsSpreadsheetUrl ??
        `https://docs.google.com/spreadsheets/d/${metadata.supplierPaymentsSpreadsheetId}/edit`,
    };
  }

  const created = await withRetry(() =>
    sheets.spreadsheets.create({
      requestBody: {
        properties: { title: "AI Office Worker - Supplier Payments" },
        sheets: [{ properties: { title: SHEET_TITLE, index: 0 } }],
      },
      fields: "spreadsheetId,spreadsheetUrl",
    }),
    "[sheets] create supplier payments spreadsheet"
  );
  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Failed to create supplier payments spreadsheet");
  const spreadsheetUrl =
    created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  await prisma.integration.upsert({
    where: { organizationId_provider: { organizationId, provider: "sheets" } },
    create: {
      organizationId,
      provider: "sheets",
      metadata: JSON.stringify({
        ...metadata,
        supplierPaymentsSpreadsheetId: spreadsheetId,
        supplierPaymentsSpreadsheetUrl: spreadsheetUrl,
      }),
    },
    update: {
      metadata: JSON.stringify({
        ...metadata,
        supplierPaymentsSpreadsheetId: spreadsheetId,
        supplierPaymentsSpreadsheetUrl: spreadsheetUrl,
      }),
    },
  });

  return { spreadsheetId, spreadsheetUrl };
}

async function ensureHeaders(organizationId: string, spreadsheetId: string) {
  const { sheets } = await getGoogleClients(organizationId);
  const meta = await withRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    }),
    "[sheets] get spreadsheet metadata"
  );
  const hasSheet = meta.data.sheets?.some((sheet) => sheet.properties?.title === SHEET_TITLE);
  if (!hasSheet) {
    await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_TITLE } } }],
        },
      }),
      "[sheets] add supplier payments sheet"
    );
  }

  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TITLE}!A1:G1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    }),
    "[sheets] update supplier payment headers"
  );
}

async function findSupplierPaymentRow(
  organizationId: string,
  spreadsheetId: string,
  key: { gmailLink: string | null; supplier: string; amount: number; dueDate: string }
) {
  const { sheets } = await getGoogleClients(organizationId);
  const result = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_TITLE}!A2:G`,
    }),
    "[sheets] find supplier payment row"
  );
  const rows = result.data.values ?? [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowSupplier = String(row[0] ?? "");
    const rowAmount = Number(row[1] ?? 0);
    const rowDueDate = String(row[2] ?? "");
    const rowGmailLink = String(row[5] ?? "");
    if (key.gmailLink && rowGmailLink && key.gmailLink === rowGmailLink) return index + 2;
    if (
      normalizeKey(rowSupplier) === normalizeKey(key.supplier) &&
      Number.isFinite(rowAmount) &&
      Math.abs(rowAmount - key.amount) < 0.01 &&
      rowDueDate === key.dueDate
    ) {
      return index + 2;
    }
  }
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function parseMetadata(value?: string | null): SheetMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as SheetMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isRetryableError(err)) break;
      console.warn(`${label} retry=${attempt} reason="${err instanceof Error ? err.message : String(err)}"`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

function isRetryableError(err: unknown) {
  const candidate = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const status = Number(candidate.status ?? candidate.code ?? candidate.response?.status ?? 0);
  return status === 0 || status === 408 || status === 429 || status >= 500;
}
