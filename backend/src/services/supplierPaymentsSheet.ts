import { prisma } from "../lib/prisma.js";
import { getGoogleClients } from "./google.js";

const SHEET_TITLE = "טבלת חשבוניות חכמה";
const HEADERS = [
  "paymentId",
  "supplierName",
  "supplierTaxId",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "amount",
  "status",
  "source",
  "duplicateDetected",
  "duplicateReason",
  "driveFileLink",
  "driveFolderLink",
  "paidDate",
  "receiptLink",
  "createdAt",
  "updatedAt",
];

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
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: Date | string | null;
  source?: string | null;
  duplicateDetected?: boolean;
  duplicateReason?: string | null;
  driveFolderLink?: string | null;
  paidDate?: Date | string | null;
  receiptLink?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}) {
  const { sheets } = await getGoogleClients(input.organizationId);
  const spreadsheet = await ensureSupplierPaymentsSpreadsheet(input.organizationId);
  await ensureHeaders(input.organizationId, spreadsheet.spreadsheetId);

  const status = input.paid ? "Paid" : input.missingInvoice ? "Missing Invoice" : "Pending";
  const invoiceDateValue = dateValue(input.invoiceDate ?? input.date);
  const dueDateValue = (input.dueDate ?? input.date).toISOString().slice(0, 10);
  const driveFileLink = input.invoiceLink ?? input.documentLink ?? input.gmailLink ?? "";
  const receiptLink = input.receiptLink ?? (input.paid ? input.documentLink ?? input.invoiceLink ?? "" : "");
  const values = [
    input.paymentId ?? "",
    input.supplier,
    input.supplierTaxId ?? "",
    input.invoiceNumber ?? "",
    invoiceDateValue,
    dueDateValue,
    input.amount,
    status,
    normalizeSheetSource(input.source),
    input.duplicateDetected ? "TRUE" : "FALSE",
    input.duplicateReason ?? "",
    driveFileLink,
    input.driveFolderLink ?? "",
    dateValue(input.paidDate),
    receiptLink,
    dateTimeValue(input.createdAt),
    dateTimeValue(input.updatedAt ?? new Date()),
  ];
  const row = await findSupplierPaymentRow(input.organizationId, spreadsheet.spreadsheetId, {
    paymentId: input.paymentId ?? null,
    supplier: input.supplier,
    supplierTaxId: input.supplierTaxId ?? null,
    invoiceNumber: input.invoiceNumber ?? null,
    amount: input.amount,
    invoiceDate: invoiceDateValue,
    dueDate: dueDateValue,
    driveFileLink: driveFileLink || null,
  });

  if (row) {
    const existingRow = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: `${SHEET_TITLE}!A${row}:Q${row}`,
      }),
      `[sheets] read supplier payment row=${row}`
    );
    const mergedValues = mergeExistingRowValues(values, existingRow.data.values?.[0] ?? []);
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: `${SHEET_TITLE}!A${row}:Q${row}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [mergedValues] },
      }),
      `[sheets] update supplier payment row=${row}`
    );
    return { ...spreadsheet, row, updated: true };
  }

  const append = await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: `${SHEET_TITLE}!A:Q`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    }),
    "[sheets] append supplier payment"
  );

  const rowNumber = Number(append.data.updates?.updatedRange?.match(/![A-Z]+(\d+):/)?.[1] ?? 0) || null;
  return { ...spreadsheet, row: rowNumber, updated: false };
}

export async function ensureSupplierPaymentsSpreadsheet(organizationId: string) {
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

export async function verifySupplierPaymentsSheet(organizationId: string) {
  const { sheets } = await getGoogleClients(organizationId);
  const spreadsheet = await ensureSupplierPaymentsSpreadsheet(organizationId);
  await ensureHeaders(organizationId, spreadsheet.spreadsheetId);
  const [payments, rowsResult] = await Promise.all([
    prisma.supplierPayment.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: `${SHEET_TITLE}!A2:Q`,
      }),
      "[sheets] verify supplier payment rows"
    ),
  ]);
  const rows = rowsResult.data.values ?? [];
  const presentKeys = new Set<string>();
  const duplicateKeys = new Map<string, number>();
  const duplicateRows: Array<{ row: number; key: string }> = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    for (const key of rowPresenceKeys(row)) {
      presentKeys.add(key);
    }
    const duplicateKey = rowDuplicateKey(row);
    if (!duplicateKey) continue;
    const count = duplicateKeys.get(duplicateKey) ?? 0;
    if (count > 0) duplicateRows.push({ row: index + 2, key: duplicateKey });
    duplicateKeys.set(duplicateKey, count + 1);
  }
  const missingRows = payments
    .map((payment) => {
      const invoiceDate = payment.date.toISOString().slice(0, 10);
      const dueDate = (payment.dueDate ?? payment.date).toISOString().slice(0, 10);
      return {
      paymentId: payment.id,
      supplier: payment.supplier,
      amount: payment.amount,
      invoiceDate,
      key: payment.id,
      fallbackKeys: [
        `${normalizeKey(payment.supplier)}:${payment.amount.toFixed(2)}:${invoiceDate}`,
        `${normalizeKey(payment.supplier)}:${payment.amount.toFixed(2)}:${dueDate}`,
      ],
    };
    })
    .filter((payment) => !presentKeys.has(payment.key) && !payment.fallbackKeys.some((key) => presentKeys.has(key)))
    .map(({ fallbackKeys: _fallbackKeys, ...payment }) => payment);
  return {
    spreadsheetId: spreadsheet.spreadsheetId,
    spreadsheetUrl: spreadsheet.spreadsheetUrl,
    totalSupplierPaymentsInDatabase: payments.length,
    totalRowsInGoogleSheet: rows.length,
    difference: Math.abs(payments.length - rows.length),
    warning: Math.abs(payments.length - rows.length) > 0,
    missingRows,
    missingRowsCount: missingRows.length,
    duplicateRows,
    duplicateRowsCount: duplicateRows.length,
    lastSyncTime: rows.reduce<string | null>((latest, row) => {
      const updatedAt = String(row[16] ?? "");
      return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest;
    }, null),
  };
}

export async function getSupplierPaymentsSheetReconciliation(organizationId: string) {
  const verification = await verifySupplierPaymentsSheet(organizationId);
  return {
    dbCount: verification.totalSupplierPaymentsInDatabase,
    googleSheetCount: verification.totalRowsInGoogleSheet,
    difference: verification.difference,
    warning: verification.warning,
    missingRowsCount: verification.missingRowsCount,
    duplicateRowsCount: verification.duplicateRowsCount,
    lastSyncTime: verification.lastSyncTime,
    spreadsheetUrl: verification.spreadsheetUrl,
  };
}

export async function getMissingInvoicesReportFromSheetComparison(organizationId: string) {
  const verification = await verifySupplierPaymentsSheet(organizationId);
  const missingPaymentIds = new Set(verification.missingRows.map((row) => row.paymentId));
  const payments = await prisma.supplierPayment.findMany({
    where: missingInvoicesReportWhere(organizationId),
    orderBy: { date: "desc" },
  });
  return payments.map((payment) => ({
    ...payment,
    sheetSyncStatus: missingPaymentIds.has(payment.id) ? "missing_in_google_sheet" : "synced_to_google_sheet",
  }));
}

export function missingInvoicesReportWhere(organizationId: string) {
  return {
    organizationId,
    approvalStatus: "approved",
    missingInvoice: true,
    paid: false,
    duplicateDetected: false,
  };
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
      range: `${SHEET_TITLE}!A1:Q1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    }),
    "[sheets] update supplier payment headers"
  );
}

async function findSupplierPaymentRow(
  organizationId: string,
  spreadsheetId: string,
  key: {
    paymentId: string | null;
    supplier: string;
    supplierTaxId: string | null;
    invoiceNumber: string | null;
    amount: number;
    invoiceDate: string;
    dueDate: string;
    driveFileLink: string | null;
  }
) {
  const { sheets } = await getGoogleClients(organizationId);
  const result = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_TITLE}!A2:Q`,
    }),
    "[sheets] find supplier payment row"
  );
  const rows = result.data.values ?? [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowPaymentId = String(row[0] ?? "");
    const rowSupplier = String(row[1] ?? "");
    const rowSupplierTaxId = String(row[2] ?? "");
    const rowInvoiceNumber = String(row[3] ?? "");
    const rowInvoiceDate = String(row[4] ?? "");
    const rowAmount = Number(row[6] ?? 0);
    const rowDriveFileLink = String(row[11] ?? "");
    if (isLegacyRow(row)) {
      const legacySupplier = String(row[0] ?? "");
      const legacyAmount = Number(row[1] ?? 0);
      const legacyDueDate = String(row[2] ?? "");
      const legacyFileLink = String(row[4] ?? "") || String(row[5] ?? "");
      if (key.driveFileLink && legacyFileLink && key.driveFileLink === legacyFileLink) return index + 2;
      if (
        normalizeKey(legacySupplier) === normalizeKey(key.supplier) &&
        Number.isFinite(legacyAmount) &&
        Math.abs(legacyAmount - key.amount) < 0.01 &&
        legacyDueDate === key.dueDate
      ) {
        return index + 2;
      }
    }
    if (key.paymentId && rowPaymentId === key.paymentId) return index + 2;
    if (key.driveFileLink && rowDriveFileLink && key.driveFileLink === rowDriveFileLink) return index + 2;
    if (
      key.supplierTaxId &&
      key.invoiceNumber &&
      normalizeKey(rowSupplierTaxId) === normalizeKey(key.supplierTaxId) &&
      normalizeKey(rowInvoiceNumber) === normalizeKey(key.invoiceNumber)
    ) {
      return index + 2;
    }
    if (
      normalizeKey(rowSupplier) === normalizeKey(key.supplier) &&
      Number.isFinite(rowAmount) &&
      Math.abs(rowAmount - key.amount) < 0.01 &&
      rowInvoiceDate === key.invoiceDate
    ) {
      return index + 2;
    }
  }
  return null;
}

function rowPresenceKeys(row: unknown[]) {
  const keys: string[] = [];
  const paymentId = String(row[0] ?? "");
  if (paymentId && !isLegacyRow(row)) keys.push(paymentId);
  const duplicateKey = rowDuplicateKey(row);
  if (duplicateKey) keys.push(duplicateKey);
  return keys;
}

function rowDuplicateKey(row: unknown[]) {
  if (isLegacyRow(row)) {
    const supplier = normalizeKey(String(row[0] ?? ""));
    const amount = Number(row[1] ?? 0);
    const dueDate = String(row[2] ?? "");
    if (supplier && dueDate && Number.isFinite(amount)) return `${supplier}:${amount.toFixed(2)}:${dueDate}`;
  }
  const supplierTaxId = normalizeKey(String(row[2] ?? ""));
  const invoiceNumber = normalizeKey(String(row[3] ?? ""));
  if (supplierTaxId && invoiceNumber) return `${supplierTaxId}:${invoiceNumber}`;
  const supplier = normalizeKey(String(row[1] ?? ""));
  const invoiceDate = String(row[4] ?? "");
  const amount = Number(row[6] ?? 0);
  if (supplier && invoiceDate && Number.isFinite(amount)) return `${supplier}:${amount.toFixed(2)}:${invoiceDate}`;
  const paymentId = String(row[0] ?? "");
  if (paymentId) return paymentId;
  return null;
}

function isLegacyRow(row: unknown[]) {
  return Number.isFinite(Number(row[1] ?? NaN)) && !String(row[0] ?? "").startsWith("cm") && row.length <= 7;
}

function normalizeSheetSource(source?: string | null) {
  if (source === "both") return "both";
  if (source === "whatsapp") return "whatsapp";
  return "gmail";
}

function dateValue(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dateTimeValue(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function mergeExistingRowValues(nextValues: Array<string | number>, existingValues: unknown[]) {
  const merged = [...nextValues];
  for (const index of [2, 3, 4, 11, 12, 13, 14, 15]) {
    if ((merged[index] === "" || merged[index] === null || merged[index] === undefined) && existingValues[index]) {
      merged[index] = String(existingValues[index]);
    }
  }
  return merged;
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
