import { prisma } from "../lib/prisma.js";
import { getGoogleClients } from "./google.js";

const SHEET_TITLE = "Supplier Payments";
const HEADERS = ["Supplier", "Date", "Amount", "Status", "Document Link"];

type SheetMetadata = {
  supplierPaymentsSpreadsheetId?: string;
  supplierPaymentsSpreadsheetUrl?: string;
};

export async function appendSupplierPaymentToSheet(input: {
  organizationId: string;
  supplier: string;
  date: Date;
  amount: number;
  paid: boolean;
  missingInvoice: boolean;
  documentLink?: string | null;
  invoiceLink?: string | null;
}) {
  const { sheets } = await getGoogleClients(input.organizationId);
  const spreadsheet = await ensureSupplierPaymentsSpreadsheet(input.organizationId);
  await ensureHeaders(input.organizationId, spreadsheet.spreadsheetId);

  const status = input.paid ? "paid" : input.missingInvoice ? "missing_invoice" : "pending";
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheet.spreadsheetId,
    range: `${SHEET_TITLE}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        input.supplier,
        input.date.toISOString().slice(0, 10),
        input.amount,
        status,
        input.documentLink ?? input.invoiceLink ?? "",
      ]],
    },
  });

  return spreadsheet;
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

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: "AI Office Worker - Supplier Payments" },
      sheets: [{ properties: { title: SHEET_TITLE, index: 0 } }],
    },
    fields: "spreadsheetId,spreadsheetUrl",
  });
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
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const hasSheet = meta.data.sheets?.some((sheet) => sheet.properties?.title === SHEET_TITLE);
  if (!hasSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_TITLE } } }],
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TITLE}!A1:E1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] },
  });
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
