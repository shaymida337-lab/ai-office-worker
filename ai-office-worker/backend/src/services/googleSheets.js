const { google } = require('googleapis');
const { getAuthClient } = require('./googleAuth');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient();

const SHEET_NAME = 'ניהול חשבוניות ותשלומים';
const HEADERS = [
  'תאריך קליטה', 'ספק', 'סוג מסמך', 'מספר חשבונית',
  'סכום לפני מע"מ', 'מע"מ', 'סכום כולל', 'מטבע',
  'תאריך לתשלום', 'שולח', 'נושא מייל', 'סטטוס',
  'דורש פעולה', 'קישור לקובץ', 'הערות AI', 'מזהה מסמך'
];

const DOC_TYPE_MAP = {
  INVOICE: 'חשבונית',
  RECEIPT: 'קבלה',
  PAYMENT_REQUEST: 'דרישת תשלום',
  QUOTE: 'הצעת מחיר',
  OTHER: 'אחר',
};

const STATUS_MAP = {
  NEW: 'חדש',
  PAID: 'שולם',
  OVERDUE: 'באיחור',
  NEEDS_REVIEW: 'דורש בדיקה',
  MISSING_INVOICE: 'חסרה חשבונית',
};

/**
 * Ensure the user's Google Sheet exists. Create if not.
 * Returns the spreadsheet ID.
 */
const ensureSheet = async (user) => {
  if (user.sheetsId) return user.sheetsId;

  const auth = await getAuthClient(user);
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SHEET_NAME },
      sheets: [{
        properties: { title: 'מסמכים', index: 0 },
        data: [{
          rowData: [{
            values: HEADERS.map(h => ({
              userEnteredValue: { stringValue: h },
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.24, green: 0.52, blue: 0.78 },
              },
            })),
          }],
        }],
      }],
    },
    fields: 'spreadsheetId',
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId;
  logger.info('Sheets created', { userId: user.id, spreadsheetId });

  // Save to DB
  await prisma.user.update({
    where: { id: user.id },
    data: { sheetsId: spreadsheetId },
  });

  return spreadsheetId;
};

/**
 * Append a new document row to the user's sheet.
 * Returns the row number.
 */
const appendDocumentRow = async (user, doc) => {
  const spreadsheetId = await ensureSheet(user);
  const auth = await getAuthClient(user);
  const sheets = google.sheets({ version: 'v4', auth });

  const row = [
    doc.createdAt ? new Date(doc.createdAt).toLocaleDateString('he-IL') : '',
    doc.vendorName || '',
    DOC_TYPE_MAP[doc.docType] || doc.docType || '',
    doc.invoiceNumber || '',
    doc.amountPreTax?.toString() || '',
    doc.taxAmount?.toString() || '',
    doc.totalAmount?.toString() || '',
    doc.currency || 'ILS',
    doc.paymentDueDate ? new Date(doc.paymentDueDate).toLocaleDateString('he-IL') : '',
    doc.emailSender || '',
    doc.emailSubject || '',
    STATUS_MAP[doc.status] || doc.status || '',
    doc.requiresAction ? 'כן' : 'לא',
    doc.driveFileUrl || '',
    doc.aiNotes || '',
    doc.id || '',
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'מסמכים!A:P',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  const updatedRange = res.data.updates?.updatedRange || '';
  const rowNum = parseInt(updatedRange.match(/:(\d+)/)?.[1] || '2');

  logger.info('Row appended to Sheet', { userId: user.id, spreadsheetId, rowNum });
  return rowNum;
};

/**
 * Update a specific row's status in the sheet.
 */
const updateRowStatus = async (user, sheetsRow, newStatus) => {
  if (!user.sheetsId || !sheetsRow) return;

  const auth = await getAuthClient(user);
  const sheets = google.sheets({ version: 'v4', auth });

  const statusCol = 'L'; // Column 12 = status
  await sheets.spreadsheets.values.update({
    spreadsheetId: user.sheetsId,
    range: `מסמכים!${statusCol}${sheetsRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[STATUS_MAP[newStatus] || newStatus]] },
  });
};

module.exports = { ensureSheet, appendDocumentRow, updateRowStatus };
