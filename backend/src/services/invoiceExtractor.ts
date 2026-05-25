import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "../lib/config.js";

export type InvoiceStatus = "paid" | "pending" | "overdue";

export interface InvoiceData {
  clientName: string | null;
  clientEmail: string | null;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  date: string;
  dueDate: string | null;
  status: InvoiceStatus;
  description: string | null;
  pdfAttachment?: Buffer;
}

type AttachmentSummary = { filename?: string | null; mimeType?: string | null };

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

export async function extractInvoiceData(
  emailBody: string,
  subject: string,
  attachments: AttachmentSummary[],
  clientFallback?: { name?: string | null; email?: string | null }
): Promise<InvoiceData> {
  const fallback = fallbackInvoiceData(emailBody, subject, attachments, clientFallback);
  if (!anthropic) return fallback;

  const prompt = `Extract invoice details from this email. Return JSON only, no markdown.
Subject: ${subject}
Body: ${emailBody.slice(0, 8000)}
Attachments: ${attachments.map((item) => item.filename).filter(Boolean).join(", ") || "none"}

Return exactly:
{"clientName":null,"clientEmail":null,"invoiceNumber":null,"amount":0,"currency":"ILS","date":"YYYY-MM-DD","dueDate":null,"status":"pending","description":null}
If a field is missing, use null. Amount must be numeric. Status: paid, pending, overdue.`;

  try {
    const message = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content[0]?.type === "text" ? message.content[0].text : "{}";
    return normalizeInvoiceData(parseJsonObject(text) ?? {}, fallback, clientFallback);
  } catch (err) {
    console.error("[invoiceExtractor] AI extraction failed, using fallback", err);
    return fallback;
  }
}

function normalizeInvoiceData(
  parsed: Record<string, unknown>,
  fallback: InvoiceData,
  clientFallback?: { name?: string | null; email?: string | null }
): InvoiceData {
  const date = normalizeDate(firstString(parsed, ["date", "invoiceDate"])) ?? fallback.date;
  const dueDate = normalizeDate(firstString(parsed, ["dueDate", "due_date"])) ?? fallback.dueDate;
  return {
    clientName: firstString(parsed, ["clientName", "customer", "customerName"]) ?? clientFallback?.name ?? fallback.clientName,
    clientEmail: firstString(parsed, ["clientEmail", "email"]) ?? clientFallback?.email ?? fallback.clientEmail,
    invoiceNumber: firstString(parsed, ["invoiceNumber", "invoice_number", "number"]) ?? fallback.invoiceNumber,
    amount: firstNumber(parsed, ["amount", "total", "sum"]) ?? fallback.amount,
    currency: normalizeCurrency(firstString(parsed, ["currency"]) ?? fallback.currency),
    date,
    dueDate,
    status: normalizeStatus(firstString(parsed, ["status"]) ?? fallback.status),
    description: firstString(parsed, ["description", "notes"]) ?? fallback.description,
  };
}

function fallbackInvoiceData(
  emailBody: string,
  subject: string,
  attachments: AttachmentSummary[],
  clientFallback?: { name?: string | null; email?: string | null }
): InvoiceData {
  const text = `${subject}\n${emailBody}`;
  return {
    clientName: clientFallback?.name ?? null,
    clientEmail: clientFallback?.email ?? null,
    invoiceNumber:
      text.match(/(?:invoice|receipt|חשבונית|קבלה)[^\dA-Z]{0,12}([A-Z0-9-]{3,})/i)?.[1] ??
      attachments.find((item) => item.filename)?.filename?.replace(/\.[^.]+$/, "") ??
      null,
    amount: extractAmount(text) ?? 0,
    currency: /usd|\$/i.test(text) ? "USD" : /eur|€/i.test(text) ? "EUR" : "ILS",
    date: extractDate(text) ?? new Date().toISOString().slice(0, 10),
    dueDate: extractDueDate(text),
    status: /paid|שולם|קבלה/i.test(text) ? "paid" : "pending",
    description: subject || null,
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text.trim();
  try { return JSON.parse(candidate) as Record<string, unknown>; } catch { return null; }
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const amount = extractAmount(value);
      if (amount !== null) return amount;
    }
  }
  return null;
}

function extractAmount(text: string): number | null {
  const match = text.match(/(?:₪|ILS|USD|EUR|\$|€)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:[.][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/\s/g, "").replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function extractDate(text: string): string | null {
  return normalizeDate(text.match(/\b(20\d{2}[-/.][01]?\d[-/.][0-3]?\d|[0-3]?\d[-/.][01]?\d[-/.]20\d{2})\b/)?.[1] ?? null);
}

function extractDueDate(text: string): string | null {
  return normalizeDate(text.match(/(?:due|פירעון|לתשלום עד)[^\d]{0,20}(20\d{2}[-/.][01]?\d[-/.][0-3]?\d|[0-3]?\d[-/.][01]?\d[-/.]20\d{2})/i)?.[1] ?? null);
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[/.]/g, "-");
  const parts = normalized.split("-");
  const candidate = parts[0]?.length === 4 ? normalized : parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}` : normalized;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeCurrency(value: string) {
  const upper = value.toUpperCase();
  if (upper.includes("USD") || value.includes("$")) return "USD";
  if (upper.includes("EUR") || value.includes("€")) return "EUR";
  return "ILS";
}

function normalizeStatus(value: string): InvoiceStatus {
  if (/paid|שולם|קבלה/i.test(value)) return "paid";
  if (/overdue|איחור|באיחור/i.test(value)) return "overdue";
  return "pending";
}
