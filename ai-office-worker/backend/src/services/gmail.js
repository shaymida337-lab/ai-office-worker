const { google } = require('googleapis');
const { getAuthClient } = require('./googleAuth');
const { logger } = require('../utils/logger');

const FINANCIAL_KEYWORDS = [
  'חשבונית', 'חשבון', 'קבלה', 'תשלום', 'invoice', 'receipt',
  'payment', 'bill', 'quote', 'הצעת מחיר', 'דרישת תשלום',
  'אישור תשלום', 'order confirmation', 'purchase'
];

/**
 * Fetch new emails from Gmail since the last scan.
 * Returns only emails that look financial.
 */
const scanNewEmails = async (user, sinceDate = null) => {
  const auth = await getAuthClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  // Build query: unread or recent financial-looking emails
  const afterDate = sinceDate
    ? Math.floor(sinceDate.getTime() / 1000)
    : Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000); // last 7 days

  const query = `after:${afterDate} (${FINANCIAL_KEYWORDS.map(k => `"${k}"`).join(' OR ')})`;

  logger.info('Gmail scan started', { userId: user.id, query });

  let messages = [];
  let pageToken = null;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50,
      ...(pageToken && { pageToken }),
    });

    if (res.data.messages) {
      messages = messages.concat(res.data.messages);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  logger.info('Gmail scan found messages', { userId: user.id, count: messages.length });

  const emails = [];
  for (const msg of messages) {
    try {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });
      emails.push(parseEmailMessage(full.data));
    } catch (err) {
      logger.error('Failed to fetch email', { msgId: msg.id, error: err.message });
    }
  }

  return emails;
};

/**
 * Parse a raw Gmail message into a structured object.
 */
const parseEmailMessage = (msg) => {
  const headers = msg.payload?.headers || [];
  const get = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const subject = get('Subject');
  const from = get('From');
  const date = get('Date');

  // Extract sender name and email
  const fromMatch = from.match(/^(.+?)\s*<(.+?)>$/) || [null, from, from];
  const senderName = fromMatch[1]?.trim().replace(/^"|"$/g, '') || from;
  const senderEmail = fromMatch[2]?.trim() || from;

  // Get body text
  const bodyText = extractBody(msg.payload);

  // Get attachments
  const attachments = extractAttachmentInfo(msg.payload);

  return {
    gmailMessageId: msg.id,
    subject,
    senderName,
    senderEmail,
    receivedAt: new Date(date || Date.now()),
    bodyText,
    attachments,
    snippet: msg.snippet || '',
  };
};

const extractBody = (payload) => {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    const html = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractBody(part);
      if (text) return text;
    }
  }

  return '';
};

const extractAttachmentInfo = (payload, attachments = []) => {
  if (!payload) return attachments;

  if (payload.filename && payload.body?.attachmentId) {
    const ext = payload.filename.split('.').pop()?.toLowerCase();
    if (['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'xlsx', 'xls'].includes(ext)) {
      attachments.push({
        filename: payload.filename,
        mimeType: payload.mimeType,
        attachmentId: payload.body.attachmentId,
        size: payload.body.size,
      });
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      extractAttachmentInfo(part, attachments);
    }
  }

  return attachments;
};

/**
 * Download a specific attachment from Gmail.
 * Returns base64 encoded data.
 */
const downloadAttachment = async (user, messageId, attachmentId) => {
  const auth = await getAuthClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  return res.data.data; // base64url encoded
};

module.exports = { scanNewEmails, downloadAttachment };
