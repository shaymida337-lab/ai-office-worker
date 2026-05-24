import { prisma } from "../lib/prisma.js";
import { getGoogleClientsForClient } from "./google.js";

const INVOICE_TAB = "חשבוניות";
const TASK_TAB = "משימות";
const INVOICE_HEADERS = [
  "תאריך",
  "ספק",
  "סכום",
  "מטבע",
  "קישור לחשבונית",
  "קישור לתיקייה",
  "נושא מייל",
  "סטטוס",
  "הערות",
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
    range: `${INVOICE_TAB}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          invoice.date.toLocaleDateString("he-IL"),
          invoice.supplier,
          invoice.amount,
          invoice.currency,
          invoice.driveFileUrl ?? "",
          invoice.driveFolderUrl ?? client.driveFolderUrl ?? "",
          invoice.emailSubject ?? "",
          invoice.status,
          invoice.notes ?? "",
        ],
      ],
    },
  });
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
