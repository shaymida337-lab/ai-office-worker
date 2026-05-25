import { prisma } from "../lib/prisma.js";
import { getGoogleClientsForClient } from "./google.js";

const INVOICE_TAB = "חשבוניות";
const TASK_TAB = "משימות";
const INVOICE_HEADERS = [
  "תאריך",
  "מספר חשבונית",
  "שם לקוח",
  "תיאור",
  "סכום",
  "מטבע",
  "סטטוס",
  "תאריך פירעון",
  "קישור ל-Drive",
  "תאריך סריקה",
];
const TASK_HEADERS = [
  "תאריך קבלה",
  "שולח",
  "נושא",
  "סיכום",
  "פעולה נדרשת",
  "עדיפות",
  "תאריך יעד",
  "סטטוס",
];

export async function writeClientInvoiceToSheet(
  clientId: string,
  invoice: {
    date: Date;
    supplier: string;
    amount: number;
    currency: string;
    driveFileUrl?: string | null;
    driveFolderUrl?: string | null;
    emailSubject?: string | null;
    status: string;
    notes?: string | null;
  }
) {
  const { sheets, client } = await getGoogleClientsForClient(clientId);
  const spreadsheetId = await ensureClientSpreadsheet(clientId, "invoice");
  await ensureSheetHeaders(sheets, spreadsheetId, INVOICE_TAB, INVOICE_HEADERS);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${INVOICE_TAB}!A:J`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          invoice.date.toLocaleDateString("he-IL"),
          "",
          invoice.supplier,
          [invoice.emailSubject, invoice.notes].filter(Boolean).join(" - "),
          invoice.amount,
          invoice.currency,
          invoice.status,
          "",
          invoice.driveFileUrl ?? invoice.driveFolderUrl ?? client.driveFolderUrl ?? "",
          new Date().toLocaleString("he-IL"),
        ],
      ],
    },
  });
}

export async function logInvoiceToSheets(
  clientId: string,
  invoice: {
    invoiceNumber?: string | null;
    clientName?: string | null;
    description?: string | null;
    amount: number;
    currency: string;
    date: Date;
    dueDate?: Date | null;
    status: string;
  },
  driveUrl: string | null
) {
  const { sheets } = await getGoogleClientsForClient(clientId);
  const spreadsheetId = await ensureClientSpreadsheet(clientId, "invoice");
  await ensureSheetHeaders(sheets, spreadsheetId, INVOICE_TAB, INVOICE_HEADERS);

  const append = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: INVOICE_TAB + "!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        invoice.date.toLocaleDateString("he-IL"),
        invoice.invoiceNumber ?? "",
        invoice.clientName ?? "",
        invoice.description ?? "",
        invoice.amount,
        invoice.currency,
        statusLabel(invoice.status),
        invoice.dueDate ? invoice.dueDate.toLocaleDateString("he-IL") : "",
        driveUrl ?? "",
        new Date().toLocaleString("he-IL"),
      ]],
    },
  });

  const row = extractUpdatedRow(append.data.updates?.updatedRange);
  if (row) await colorInvoiceRow(sheets, spreadsheetId, INVOICE_TAB, row, invoice.status);
  return { spreadsheetId, row };
}

export async function updateInvoiceStatusInSheets(clientId: string, row: number | null | undefined, status: string) {
  if (!row) return;
  const { sheets } = await getGoogleClientsForClient(clientId);
  const spreadsheetId = await ensureClientSpreadsheet(clientId, "invoice");
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: INVOICE_TAB + "!G" + row,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[statusLabel(status)]] },
  });
  await colorInvoiceRow(sheets, spreadsheetId, INVOICE_TAB, row, status);
}

export async function writeClientTaskToSheet(
  clientId: string,
  task: {
    date: Date;
    from: string;
    subject: string;
    summary: string;
    action: string;
    priority: string;
    dueDate?: Date | null;
    status: string;
  }
) {
  const { sheets } = await getGoogleClientsForClient(clientId);
  const spreadsheetId = await ensureClientSpreadsheet(clientId, "task");
  await ensureSheetHeaders(sheets, spreadsheetId, TASK_TAB, TASK_HEADERS);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TASK_TAB}!A:H`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          task.date.toLocaleDateString("he-IL"),
          task.from,
          task.subject,
          task.summary,
          task.action,
          task.priority,
          task.dueDate ? task.dueDate.toLocaleDateString("he-IL") : "",
          task.status,
        ],
      ],
    },
  });
}

async function ensureClientSpreadsheet(clientId: string, type: "invoice" | "task") {
  const { sheets, client } = await getGoogleClientsForClient(clientId);
  const existingId = type === "invoice" ? client.invoiceSheetId : client.taskSheetId;
  if (existingId) return existingId;

  const title = `${client.name} - ${type === "invoice" ? "חשבוניות" : "משימות"}`;
  const tab = type === "invoice" ? INVOICE_TAB : TASK_TAB;
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: tab, index: 0 } }],
    },
    fields: "spreadsheetId,spreadsheetUrl",
  });

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Failed to create client spreadsheet");

  const spreadsheetUrl =
    created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  await prisma.client.update({
    where: { id: clientId },
    data:
      type === "invoice"
        ? { invoiceSheetId: spreadsheetId, invoiceSheetUrl: spreadsheetUrl }
        : { taskSheetId: spreadsheetId, taskSheetUrl: spreadsheetUrl },
  });

  return spreadsheetId;
}

async function ensureSheetHeaders(
  sheets: Awaited<ReturnType<typeof getGoogleClientsForClient>>["sheets"],
  spreadsheetId: string,
  tab: string,
  headers: string[]
) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tab } } }],
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A1:${String.fromCharCode(64 + headers.length)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] },
  });
}

async function colorInvoiceRow(
  sheets: Awaited<ReturnType<typeof getGoogleClientsForClient>>["sheets"],
  spreadsheetId: string,
  tab: string,
  row: number,
  status: string
) {
  const sheetId = await getSheetId(sheets, spreadsheetId, tab);
  if (sheetId === null) return;
  const color = status === "paid"
    ? { red: 0.85, green: 0.95, blue: 0.88 }
    : status === "overdue"
      ? { red: 0.98, green: 0.86, blue: 0.86 }
      : { red: 0.98, green: 0.93, blue: 0.75 };
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: INVOICE_HEADERS.length },
          cell: { userEnteredFormat: { backgroundColor: color } },
          fields: "userEnteredFormat.backgroundColor",
        },
      }],
    },
  });
}

async function getSheetId(
  sheets: Awaited<ReturnType<typeof getGoogleClientsForClient>>["sheets"],
  spreadsheetId: string,
  tab: string
) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" });
  return meta.data.sheets?.find((sheet) => sheet.properties?.title === tab)?.properties?.sheetId ?? null;
}

function extractUpdatedRow(range?: string | null) {
  const match = range?.match(/![A-Z]+(d+):/);
  return match ? Number(match[1]) : null;
}

function statusLabel(status: string) {
  if (status === "paid") return "שולם";
  if (status === "overdue") return "באיחור";
  return "ממתין";
}
