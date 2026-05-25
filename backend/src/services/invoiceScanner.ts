import { prisma } from "../lib/prisma.js";
import { getGoogleClientsForClient } from "./google.js";
import { extractInvoiceData } from "./invoiceExtractor.js";
import { saveInvoiceToDrive } from "./driveOrganizer.js";
import { logInvoiceToSheets } from "./clientSheetsService.js";

const INVOICE_KEYWORDS = [
  "חשבונית", "invoice", "receipt", "קבלה", "תשלום", "payment", "חשבון", "billing", "הצעת מחיר", "quote", "הזמנה", "order",
];
const URGENT_KEYWORDS = [
  "דחוף", "urgent", "overdue", "באיחור", "reminder", "תזכורת", "final notice", "הודעה אחרונה",
];

type GmailClient = Awaited<ReturnType<typeof getGoogleClientsForClient>>["gmail"];
type PayloadPart = {
  filename?: string | null;
  mimeType?: string | null;
  body?: { attachmentId?: string | null; data?: string | null } | null;
  parts?: PayloadPart[] | null;
};

type DownloadedAttachment = { filename: string; mimeType: string | null; buffer: Buffer };

type ScanOptions = { daysBack?: number; limit?: number };

export async function scanForInvoices(clientId: string, options: ScanOptions = {}) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.gmailConnected || !client.googleRefreshToken) throw new Error("חבר Gmail בהגדרות");

  const organizationId = client.organizationId;
  const { gmail, drive } = await getGoogleClientsForClient(clientId);
  const messages = await listInvoiceMessages(gmail, options.daysBack ?? 30, options.limit ?? 50);
  const errors: Array<{ emailId?: string; error: string }> = [];
  let found = 0;
  let saved = 0;

  for (const ref of messages) {
    if (!ref.id) continue;
    try {
      const full = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "full" });
      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(ללא נושא)";
      const dateHeader = headers.find((h) => h.name === "Date")?.value ?? "";
      const receivedAt = dateHeader ? new Date(dateHeader) : new Date();
      const bodyText = extractBody(full.data.payload as PayloadPart | undefined);
      const parts = collectParts(full.data.payload as PayloadPart | undefined);
      const pdfParts = parts.filter((part) => isPdf(part));
      if (!isInvoiceCandidate(subject, bodyText, parts) && pdfParts.length === 0) continue;
      found++;

      const attachments: DownloadedAttachment[] = [];
      for (const part of pdfParts) {
        const attachmentId = part.body?.attachmentId;
        if (!attachmentId || !part.filename) continue;
        const attachment = await gmail.users.messages.attachments.get({ userId: "me", messageId: ref.id, id: attachmentId });
        attachments.push({ filename: part.filename, mimeType: part.mimeType ?? "application/pdf", buffer: decodeBase64Url(attachment.data.data ?? "") });
      }

      const invoice = await extractInvoiceData(
        bodyText,
        subject,
        parts.map((part) => ({ filename: part.filename, mimeType: part.mimeType })),
        { name: client.name, email: client.email }
      );
      invoice.pdfAttachment = attachments[0]?.buffer;

      const existing = await prisma.invoice.findFirst({
        where: { organizationId, clientId, emailId: ref.id, ...(invoice.invoiceNumber ? { invoiceNumber: invoice.invoiceNumber } : {}) },
      });
      if (existing) continue;

      let driveUrl: string | null = null;
      if (attachments[0]) {
        try {
          const uploaded = await saveInvoiceToDrive(drive, invoice, attachments[0].buffer, organizationId);
          driveUrl = uploaded.webViewLink;
        } catch (err) {
          errors.push({ emailId: ref.id, error: `Drive upload failed: ${errorMessage(err)}` });
        }
      }

      let sheetsRow: number | null = null;
      try {
        const sheet = await logInvoiceToSheets(
          clientId,
          {
            invoiceNumber: invoice.invoiceNumber,
            clientName: invoice.clientName ?? client.name,
            description: invoice.description,
            amount: invoice.amount,
            currency: invoice.currency,
            date: parseDate(invoice.date, receivedAt),
            dueDate: invoice.dueDate ? parseDate(invoice.dueDate, null) : null,
            status: invoice.status,
          },
          driveUrl
        );
        sheetsRow = sheet.row;
      } catch (err) {
        errors.push({ emailId: ref.id, error: `Sheets logging failed: ${errorMessage(err)}` });
      }

      await prisma.invoice.create({
        data: {
          organizationId,
          clientId,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.amount,
          currency: invoice.currency,
          date: parseDate(invoice.date, receivedAt),
          dueDate: invoice.dueDate ? parseDate(invoice.dueDate, null) : null,
          status: invoice.status,
          description: invoice.description,
          driveUrl,
          sheetsRow,
          emailId: ref.id,
        },
      });
      saved++;
    } catch (err) {
      errors.push({ emailId: ref.id ?? undefined, error: errorMessage(err) });
    }
  }

  return { found, saved, errors };
}

export function detectInvoice(input: { subject?: string | null; body?: string | null }) {
  const text = `${input.subject ?? ""} ${input.body ?? ""}`.toLowerCase();
  return INVOICE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function detectUrgent(input: { subject?: string | null; body?: string | null }) {
  const text = `${input.subject ?? ""} ${input.body ?? ""}`.toLowerCase();
  return URGENT_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
}

async function listInvoiceMessages(gmail: GmailClient, daysBack: number, maxResults: number) {
  const byId = new Map<string, { id?: string | null }>();
  for (const q of invoiceQueries(daysBack)) {
    const result = await gmail.users.messages.list({ userId: "me", q, maxResults });
    for (const message of result.data.messages ?? []) {
      if (message.id) byId.set(message.id, message);
    }
  }
  return [...byId.values()];
}

function invoiceQueries(daysBack: number) {
  const newerThan = Math.max(1, Math.ceil(daysBack));
  return [
    `subject:(חשבונית OR invoice OR receipt OR קבלה) newer_than:${newerThan}d`,
    `has:attachment filename:pdf newer_than:${newerThan}d`,
    `subject:(תשלום OR payment OR חשבון) newer_than:${newerThan}d`,
    `from:(invoice OR billing OR חשבוניות) newer_than:${newerThan}d`,
  ];
}

function collectParts(payload?: PayloadPart): PayloadPart[] {
  const out: PayloadPart[] = [];
  if (!payload) return out;
  if (payload.filename || payload.body?.attachmentId) out.push(payload);
  for (const part of payload.parts ?? []) out.push(...collectParts(part));
  return out;
}

function extractBody(payload?: PayloadPart): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data).toString("utf8");
  if (payload.body?.data && !payload.parts?.length) return decodeBase64Url(payload.body.data).toString("utf8");
  for (const part of payload.parts ?? []) {
    const body = extractBody(part);
    if (body) return body;
  }
  return "";
}

function isPdf(part: PayloadPart) {
  return part.mimeType === "application/pdf" || /\.pdf$/i.test(part.filename ?? "");
}

function isInvoiceCandidate(subject: string, body: string, parts: PayloadPart[]) {
  return detectInvoice({ subject, body }) || parts.some((part) => detectInvoice({ subject: part.filename, body: "" }));
}

function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseDate(value: string, fallback: Date | null): Date {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  return fallback ?? new Date();
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
