const { google } = require('googleapis');
const { getAuthClient, getAuthClientForClient } = require('./googleAuth');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient();

const INVOICE_TAB = 'חשבוניות';
const TASK_TAB = 'משימות';

const INVOICE_HEADERS = [
  'תאריך', 'ספק', 'סכום', 'מטבע', 'קישור לחשבונית', 'קישור לתיקייה',
  'נושא מייל', 'סטטוס', 'הערות',
];

const TASK_HEADERS = [
  'תאריך קבלה', 'שולח', 'נושא', 'סיכום', 'פעולה נדרשת',
  'עדיפות', 'תאריך יעד', 'סטטוס',
];

const INVOICE_STATUS_MAP = {
  NEW: 'ממתין',
  PAID: 'שולם',
  OVERDUE: 'באיחור',
  NEEDS_REVIEW: 'דורש בדיקה',
  MISSING_INVOICE: 'חסרה חשבונית',
};

const PRIORITY_LABELS = {
  high: '🔴 גבוה',
  medium: '🟡 בינוני',
  low: '🟢 נמוך',
  גבוה: '🔴 גבוה',
  בינוני: '🟡 בינוני',
  נמוך: '🟢 נמוך',
};

const parseSheetIdFromUrl = (url) => {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? null;
};

const parseFolderIdFromUrl = (url) => {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? null;
};

const getSheetsClient = async (user) => {
  const auth = await getAuthClient(user);
  return google.sheets({ version: 'v4', auth });
};

const getSpreadsheetMeta = async (sheets, spreadsheetId) =>
  sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties.title' });

const ensureTabWithHeaders = async (sheets, spreadsheetId, tabName, headers) => {
  const meta = await getSpreadsheetMeta(sheets, spreadsheetId);
  const existing = meta.data.sheets?.find((s) => s.properties?.title === tabName);

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: tabName, index: meta.data.sheets?.length ?? 0 },
          },
        }],
      },
    });
  }

  const headerRange = `${tabName}!A1:${String.fromCharCode(64 + headers.length)}1`;
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });

  const firstRow = current.data.values?.[0] ?? [];
  const hasHeaders = firstRow.length >= headers.length && firstRow[0] === headers[0];

  if (!hasHeaders) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
  }

  return meta.data.properties?.title ?? tabName;
};

const getSheetsClientForClient = async (client) => {
  const auth = await getAuthClientForClient(client);
  return google.sheets({ version: 'v4', auth });
};

const getDriveFolderUrlForClient = (client) => {
  if (client.driveFolderUrl) return client.driveFolderUrl;
  if (client.driveFolderId) return `https://drive.google.com/drive/folders/${client.driveFolderId}`;
  return '';
};

const resolveClientInvoiceSheetId = (client) => client.invoiceSheetId || null;
const resolveClientTaskSheetId = (client) => client.taskSheetId || null;

const resolveInvoiceSheetId = (user) =>
  user.invoiceSheetId || user.sheetsId || null;

const resolveTaskSheetId = (user) => user.taskSheetId || null;

const getDriveFolderUrl = (user) => {
  if (user.driveFolderUrl) return user.driveFolderUrl;
  const folderId = user.driveFolderId || user.driveFolder;
  return folderId ? `https://drive.google.com/drive/folders/${folderId}` : '';
};

const testSheetConnection = async (userId, sheetUrl) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) throw new Error('Google לא מחובר');

  const spreadsheetId = parseSheetIdFromUrl(sheetUrl);
  if (!spreadsheetId) throw new Error('כתובת Google Sheet לא תקינה');

  const sheets = await getSheetsClient(user);
  await getSpreadsheetMeta(sheets, spreadsheetId);
  return true;
};

const saveUserSheetSettings = async (userId, input) => {
  const invoiceSheetId = input.invoiceSheetUrl
    ? parseSheetIdFromUrl(input.invoiceSheetUrl)
    : undefined;
  const taskSheetId = input.taskSheetUrl
    ? parseSheetIdFromUrl(input.taskSheetUrl)
    : undefined;
  const driveFolderId = input.driveFolderUrl
    ? parseFolderIdFromUrl(input.driveFolderUrl)
    : undefined;

  if (input.invoiceSheetUrl && !invoiceSheetId) {
    throw new Error('כתובת טבלת חשבוניות לא תקינה');
  }
  if (input.taskSheetUrl && !taskSheetId) {
    throw new Error('כתובת טבלת משימות לא תקינה');
  }
  if (input.driveFolderUrl && !driveFolderId) {
    throw new Error('כתובת תיקיית Drive לא תקינה');
  }

  const data = {};
  if (input.invoiceSheetUrl !== undefined) {
    data.invoiceSheetUrl = input.invoiceSheetUrl.trim() || null;
    data.invoiceSheetId = invoiceSheetId ?? null;
  }
  if (input.taskSheetUrl !== undefined) {
    data.taskSheetUrl = input.taskSheetUrl.trim() || null;
    data.taskSheetId = taskSheetId ?? null;
  }
  if (input.driveFolderUrl !== undefined) {
    data.driveFolderUrl = input.driveFolderUrl.trim() || null;
    data.driveFolderId = driveFolderId ?? null;
    if (driveFolderId) data.driveFolder = driveFolderId;
  }

  return prisma.user.update({ where: { id: userId }, data });
};

const createDefaultSpreadsheet = async (user, title) => {
  const sheets = await getSheetsClient(user);
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: INVOICE_TAB, index: 0 } }],
    },
    fields: 'spreadsheetId,spreadsheetUrl',
  });

  const spreadsheetId = created.data.spreadsheetId;
  await ensureTabWithHeaders(sheets, spreadsheetId, INVOICE_TAB, INVOICE_HEADERS);
  return {
    spreadsheetId,
    spreadsheetUrl: created.data.spreadsheetUrl
      ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
};

const writeInvoiceToSheet = async (userId, invoice) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) return null;

  let spreadsheetId = resolveInvoiceSheetId(user);
  let spreadsheetUrl = user.invoiceSheetUrl;

  if (!spreadsheetId) {
    const created = await createDefaultSpreadsheet(user, 'AI Office Worker - חשבוניות');
    spreadsheetId = created.spreadsheetId;
    spreadsheetUrl = created.spreadsheetUrl;
    await prisma.user.update({
      where: { id: userId },
      data: { invoiceSheetId: spreadsheetId, invoiceSheetUrl: spreadsheetUrl, sheetsId: spreadsheetId },
    });
  }

  const sheets = await getSheetsClient(user);
  await ensureTabWithHeaders(sheets, spreadsheetId, INVOICE_TAB, INVOICE_HEADERS);

  const statusLabel = INVOICE_STATUS_MAP[invoice.status] || invoice.status || 'ממתין';
  const row = [
    invoice.date || '',
    invoice.supplier || '',
    invoice.amount ?? '',
    invoice.currency || 'ILS',
    invoice.driveFileUrl || '',
    invoice.driveFolderUrl || getDriveFolderUrl(user),
    invoice.emailSubject || '',
    statusLabel,
    invoice.notes || '',
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${INVOICE_TAB}!A:I`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  const updatedRange = res.data.updates?.updatedRange || '';
  const rowNum = parseInt(updatedRange.match(/:(\d+)/)?.[1] || '2', 10);
  logger.info('Invoice row written to sheet', { userId, spreadsheetId, rowNum });
  return rowNum;
};

const priorityToLabel = (priority) => {
  const normalized = String(priority || 'medium').toLowerCase();
  if (normalized.includes('גבוה') || normalized === 'high') return PRIORITY_LABELS.high;
  if (normalized.includes('נמוך') || normalized === 'low') return PRIORITY_LABELS.low;
  return PRIORITY_LABELS.medium;
};

const writeTaskToSheet = async (userId, task) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) return null;

  let spreadsheetId = resolveTaskSheetId(user);
  let spreadsheetUrl = user.taskSheetUrl;

  if (!spreadsheetId) {
    const sheets = await getSheetsClient(user);
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'AI Office Worker - משימות' },
        sheets: [{ properties: { title: TASK_TAB, index: 0 } }],
      },
      fields: 'spreadsheetId,spreadsheetUrl',
    });
    spreadsheetId = created.data.spreadsheetId;
    spreadsheetUrl = created.data.spreadsheetUrl
      ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    await prisma.user.update({
      where: { id: userId },
      data: { taskSheetId: spreadsheetId, taskSheetUrl: spreadsheetUrl },
    });
    await ensureTabWithHeaders(sheets, spreadsheetId, TASK_TAB, TASK_HEADERS);
  } else {
    const sheets = await getSheetsClient(user);
    await ensureTabWithHeaders(sheets, spreadsheetId, TASK_TAB, TASK_HEADERS);
  }

  const sheets = await getSheetsClient(user);
  const row = [
    task.date || '',
    task.from || '',
    task.subject || '',
    task.summary || '',
    task.action || '',
    priorityToLabel(task.priority),
    task.dueDate || '',
    task.status || 'פתוח',
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TASK_TAB}!A:H`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  const updatedRange = res.data.updates?.updatedRange || '';
  const rowNum = parseInt(updatedRange.match(/:(\d+)/)?.[1] || '2', 10);
  logger.info('Task row written to sheet', { userId, spreadsheetId, rowNum });
  return rowNum;
};

const writeInvoiceToSheetForClient = async (clientId, invoice) => {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.googleAccessToken) return null;

  let spreadsheetId = resolveClientInvoiceSheetId(client);
  let spreadsheetUrl = client.invoiceSheetUrl;

  if (!spreadsheetId) {
    const sheets = await getSheetsClientForClient(client);
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `${client.name} - חשבוניות` },
        sheets: [{ properties: { title: INVOICE_TAB, index: 0 } }],
      },
      fields: 'spreadsheetId,spreadsheetUrl',
    });
    spreadsheetId = created.data.spreadsheetId;
    spreadsheetUrl = created.data.spreadsheetUrl
      ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    await prisma.client.update({
      where: { id: clientId },
      data: { invoiceSheetId: spreadsheetId, invoiceSheetUrl: spreadsheetUrl },
    });
    await ensureTabWithHeaders(sheets, spreadsheetId, INVOICE_TAB, INVOICE_HEADERS);
  } else {
    const sheets = await getSheetsClientForClient(client);
    await ensureTabWithHeaders(sheets, spreadsheetId, INVOICE_TAB, INVOICE_HEADERS);
  }

  const sheets = await getSheetsClientForClient(client);
  const statusLabel = INVOICE_STATUS_MAP[invoice.status] || invoice.status || 'ממתין';
  const row = [
    invoice.date || '',
    invoice.supplier || '',
    invoice.amount ?? '',
    invoice.currency || 'ILS',
    invoice.driveFileUrl || '',
    invoice.driveFolderUrl || getDriveFolderUrlForClient(client),
    invoice.emailSubject || '',
    statusLabel,
    invoice.notes || '',
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${INVOICE_TAB}!A:I`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  const updatedRange = res.data.updates?.updatedRange || '';
  return parseInt(updatedRange.match(/:(\d+)/)?.[1] || '2', 10);
};

const writeTaskToSheetForClient = async (clientId, task) => {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.googleAccessToken) return null;

  let spreadsheetId = resolveClientTaskSheetId(client);

  if (!spreadsheetId) {
    const sheets = await getSheetsClientForClient(client);
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `${client.name} - משימות` },
        sheets: [{ properties: { title: TASK_TAB, index: 0 } }],
      },
      fields: 'spreadsheetId,spreadsheetUrl',
    });
    spreadsheetId = created.data.spreadsheetId;
    const spreadsheetUrl = created.data.spreadsheetUrl
      ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    await prisma.client.update({
      where: { id: clientId },
      data: { taskSheetId: spreadsheetId, taskSheetUrl: spreadsheetUrl },
    });
    await ensureTabWithHeaders(sheets, spreadsheetId, TASK_TAB, TASK_HEADERS);
  } else {
    const sheets = await getSheetsClientForClient(client);
    await ensureTabWithHeaders(sheets, spreadsheetId, TASK_TAB, TASK_HEADERS);
  }

  const sheets = await getSheetsClientForClient(client);
  const row = [
    task.date || '',
    task.from || '',
    task.subject || '',
    task.summary || '',
    task.action || '',
    priorityToLabel(task.priority),
    task.dueDate || '',
    task.status || 'פתוח',
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TASK_TAB}!A:H`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  const updatedRange = res.data.updates?.updatedRange || '';
  return parseInt(updatedRange.match(/:(\d+)/)?.[1] || '2', 10);
};

module.exports = {
  parseSheetIdFromUrl,
  parseFolderIdFromUrl,
  getSheetsClient,
  getSheetsClientForClient,
  testSheetConnection,
  saveUserSheetSettings,
  writeInvoiceToSheet,
  writeTaskToSheet,
  writeInvoiceToSheetForClient,
  writeTaskToSheetForClient,
  getDriveFolderUrl,
  getDriveFolderUrlForClient,
  INVOICE_TAB,
  TASK_TAB,
};
