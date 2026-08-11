import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config, hasClaude } from "../lib/config.js";
import { parseLabeledAmount } from "./amount/parseAmount.js";
import { clampBusinessDateString, DEFAULT_HISTORICAL_SCAN_YEARS } from "./dates/businessDate.js";
import { isLikelyJunkSupplierName } from "./supplierNameValidation.js";

export type InvoiceStatus = "paid" | "pending" | "overdue" | "needs_review";

export interface InvoiceData {
  clientName: string | null;
  clientEmail: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  amount: number;
  amountMissing: boolean;
  currency: string;
  date: string;
  dueDate: string | null;
  status: InvoiceStatus;
  description: string | null;
  pdfAttachment?: Buffer;
}

type AttachmentSummary = { filename?: string | null; mimeType?: string | null };

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

/**
 * תיקון #2 — סכמת ולידציה קשיחה לפלט של Claude (מדיניות "אפס ניחוש").
 *
 * פלט המודל חייב להיות אובייקט JSON תקין עם השדות המוכרים בטיפוסים הצפויים.
 * .passthrough() מאפשר שדות נוספים בלי להיכשל, אבל טיפוס לא תקין (למשל amount
 * כאובייקט) פוסל את הפלט כולו — ואז נופלים ל-fallback הדטרמיניסטי במקום
 * "לנחש" מתוך מבנה פגום.
 */
const ClaudeInvoiceOutputSchema = z
  .object({
    clientName: z.string().nullish(),
    clientEmail: z.string().nullish(),
    supplierName: z.string().nullish(),
    invoiceNumber: z.union([z.string(), z.number()]).nullish(),
    amount: z.union([z.number(), z.string()]).nullish(),
    total: z.union([z.number(), z.string()]).nullish(),
    currency: z.string().nullish(),
    date: z.string().nullish(),
    invoiceDate: z.string().nullish(),
    dueDate: z.string().nullish(),
    status: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

/** ספק תקף = קיים, לא placeholder ולא זבל טכני (מדיניות אפס ניחוש). */
function hasValidExtractedSupplier(supplierName: string | null): boolean {
  const cleaned = supplierName?.trim() ?? "";
  if (!cleaned) return false;
  if (/^(unknown|unknown supplier|לא ידוע|לא מזוהה|n\/a|null|undefined)$/i.test(cleaned)) return false;
  return !isLikelyJunkSupplierName(cleaned);
}

export async function extractInvoiceData(
  emailBody: string,
  subject: string,
  attachments: AttachmentSummary[],
  clientFallback?: { name?: string | null; email?: string | null },
  // עומק היסטורי דינמי: תאריכים עד `maxPastYears` שנים אחורה נחשבים תקינים.
  // מגיע מ-organization.historicalScanYears; ברירת מחדל 2 שנים.
  options?: { maxPastYears?: number }
): Promise<InvoiceData> {
  const maxPastYears = options?.maxPastYears ?? DEFAULT_HISTORICAL_SCAN_YEARS;
  const fallback = fallbackInvoiceData(emailBody, subject, attachments, clientFallback, maxPastYears);
  if (!anthropic) return fallback;

  const prompt = `Extract invoice details from this email. Return JSON only, no markdown.
Subject: ${subject}
Body: ${emailBody.slice(0, 8000)}
Attachments: ${attachments.map((item) => item.filename).filter(Boolean).join(", ") || "none"}

Return exactly:
{"clientName":null,"clientEmail":null,"supplierName":null,"invoiceNumber":null,"amount":null,"currency":"ILS","date":"YYYY-MM-DD","dueDate":null,"status":"pending","description":null}
supplierName is the supplier/vendor/issuer business that issued the invoice, NOT the client/customer. If the supplier cannot be determined, return null. If a field is missing, use null. Amount must be numeric when present; if the total amount cannot be determined, return null for amount — never guess and never return 0 unless the document explicitly shows a zero total. Status: paid, pending, overdue.`;

  try {
    const message = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content[0]?.type === "text" ? message.content[0].text : "{}";
    const parsedRaw = parseJsonObject(text);
    // תיקון #2: ולידציית סכמה קשיחה על פלט המודל לפני שנוגעים בו.
    const validated = parsedRaw ? ClaudeInvoiceOutputSchema.safeParse(parsedRaw) : null;
    if (!validated?.success) {
      console.error(
        "[invoiceExtractor] Claude output failed schema validation, using deterministic fallback",
        validated?.error?.issues ?? "no JSON object parsed"
      );
      return fallback;
    }
    return normalizeInvoiceData(validated.data as Record<string, unknown>, fallback, clientFallback, maxPastYears);
  } catch (err) {
    console.error("[invoiceExtractor] AI extraction failed, using fallback", err);
    return fallback;
  }
}

function normalizeInvoiceData(
  parsed: Record<string, unknown>,
  fallback: InvoiceData,
  clientFallback?: { name?: string | null; email?: string | null },
  maxPastYears: number = DEFAULT_HISTORICAL_SCAN_YEARS
): InvoiceData {
  // F4: תאריכים מתשובת המודל עוברים את גבול העבר הדינמי (עד maxPastYears שנים).
  const date = clampBusinessDateString(normalizeDate(firstString(parsed, ["date", "invoiceDate"])), maxPastYears) ?? fallback.date;
  const dueDate = clampBusinessDateString(normalizeDate(firstString(parsed, ["dueDate", "due_date"])), maxPastYears) ?? fallback.dueDate;
  const parsedAmount = firstNumber(parsed, ["amount", "total", "sum", "totalAmount", "amountDue", "balanceDue"]);
  const hasParsedPositiveAmount = parsedAmount !== null && parsedAmount > 0;
  const amountMissing = hasParsedPositiveAmount ? false : fallback.amountMissing;
  const amount = hasParsedPositiveAmount ? parsedAmount : fallback.amount;
  const supplierName =
    firstString(parsed, ["supplierName", "supplier", "vendor", "vendorName", "issuer", "issuerName"]) ?? fallback.supplierName;

  // תיקון #2 — אכיפת "אפס ניחוש" על שלושת שדות הליבה:
  //   • סכום כולל חיובי (amountMissing=false ו-amount>0),
  //   • תאריך מסמך תקין בטווח ±2 שנים (clampBusinessDateString מחזיר null אחרת),
  //   • שם ספק קיים ותקף (לא placeholder/זבל).
  // אם אחד מהם חסר/לא תקין — הרשומה מנותבת ל-needs_review במקום להישמר בשקט.
  const amountValid = !amountMissing && typeof amount === "number" && amount > 0;
  const documentDateValid = clampBusinessDateString(date, maxPastYears) !== null;
  const supplierValid = hasValidExtractedSupplier(supplierName);
  const coreFieldsValid = amountValid && documentDateValid && supplierValid;

  return {
    clientName: firstString(parsed, ["clientName", "customer", "customerName"]) ?? clientFallback?.name ?? fallback.clientName,
    clientEmail: firstString(parsed, ["clientEmail", "email"]) ?? clientFallback?.email ?? fallback.clientEmail,
    supplierName,
    invoiceNumber: firstString(parsed, ["invoiceNumber", "invoice_number", "number"]) ?? fallback.invoiceNumber,
    amount,
    // amountMissing נשאר אות מדויק על הסכום עצמו; ניתוב לביקורת נעשה דרך status.
    amountMissing,
    currency: normalizeCurrency(firstString(parsed, ["currency"]) ?? fallback.currency),
    date,
    dueDate,
    status: coreFieldsValid ? normalizeStatus(firstString(parsed, ["status"]) ?? fallback.status) : "needs_review",
    description: firstString(parsed, ["description", "notes"]) ?? fallback.description,
  };
}

function fallbackInvoiceData(
  emailBody: string,
  subject: string,
  attachments: AttachmentSummary[],
  clientFallback?: { name?: string | null; email?: string | null },
  maxPastYears: number = DEFAULT_HISTORICAL_SCAN_YEARS
): InvoiceData {
  const text = `${subject}\n${emailBody}`;
  const amount = extractAmount(text);
  const hasExplicitZeroAmount = hasExplicitZeroInvoiceTotal(text);
  const amountMissing = amount === null && !hasExplicitZeroAmount;
  const supplierName = null;
  const documentDate = clampBusinessDateString(extractDate(text), maxPastYears) ?? new Date().toISOString().slice(0, 10);
  // תיקון #2 — אותה אכיפת ליבה גם במסלול ה-fallback הדטרמיניסטי: אין דרך
  // לאמת ספק מתוך regex בלבד (supplierName תמיד null), לכן חילוץ fallback
  // מנותב תמיד ל-needs_review ולא נשמר בשקט כ-paid/pending.
  const coreFieldsValid =
    !amountMissing &&
    (amount ?? 0) > 0 &&
    clampBusinessDateString(documentDate, maxPastYears) !== null &&
    hasValidExtractedSupplier(supplierName);
  return {
    clientName: clientFallback?.name ?? null,
    clientEmail: clientFallback?.email ?? null,
    supplierName,
    invoiceNumber:
      text.match(/(?:invoice|receipt|חשבונית|קבלה)[^\dA-Z]{0,12}([A-Z0-9-]{3,})/i)?.[1] ??
      attachments.find((item) => item.filename)?.filename?.replace(/\.[^.]+$/, "") ??
      null,
    // F2: הפרדה מפורשת בין "אפס אמיתי" (סה"כ 0 מופיע במסמך) לבין "לא זוהה סכום".
    // בשני המקרים הערך המספרי הוא 0 (הסכמה דורשת מספר), אבל amountMissing=true
    // רק כשלא זוהה — וזה מנתב את הסטטוס ל-needs_review ולא לשמירה שקטה.
    amount: amount ?? 0,
    amountMissing,
    currency: /usd|\$/i.test(text) ? "USD" : /eur|€/i.test(text) ? "EUR" : "ILS",
    // F4: תאריך שחולץ מהטקסט חייב לעמוד בגבול ±2 שנים; אחרת נופלים להיום.
    date: documentDate,
    dueDate: extractDueDate(text),
    status: coreFieldsValid ? (/paid|שולם|קבלה/i.test(text) ? "paid" : "pending") : "needs_review",
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
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
      const amount = extractAmount(value);
      if (amount !== null) return amount;
    }
  }
  return null;
}

function extractAmount(text: string): number | null {
  const normalized = text
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[־–—]/g, "-");
  const candidates: Array<{ raw: string; score: number; hasDateContext: boolean }> = [];

  const labelPattern =
    /(?:סה["״']?כ|סך\s*הכל|סכום\s*(?:לתשלום)?|לתשלום|לתשלום\s*עד|יתרה\s*לתשלום|total\s*(?:due|amount)?|amount\s*(?:due)?|balance\s*due|grand\s*total)[^\d₪$€]{0,40}(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)?\s*([0-9][0-9.,\s]*)(?:\s*(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur))?/gi;
  collectMatches(normalized, labelPattern, 100, candidates);

  collectMatches(
    normalized,
    /(?:₪|ils|nis|ש["״']?ח)\s*([0-9][0-9.,\s]*)/gi,
    80,
    candidates
  );
  collectMatches(
    normalized,
    /([0-9][0-9.,\s]*)\s*(?:₪|ils|nis|ש["״']?ח)/gi,
    80,
    candidates
  );
  collectMatches(normalized, /(?:\$|usd)\s*([0-9][0-9.,\s]*)|([0-9][0-9.,\s]*)\s*(?:\$|usd)/gi, 70, candidates);
  collectMatches(normalized, /(?:€|eur)\s*([0-9][0-9.,\s]*)|([0-9][0-9.,\s]*)\s*(?:€|eur)/gi, 70, candidates);

  const amounts = candidates
    .map((candidate) => {
      const parsed = parseLabeledAmount(candidate.raw);
      return {
        amount: parsed.ambiguous ? null : parsed.parsedAmount,
        score: candidate.score,
        hasDateContext: candidate.hasDateContext,
      };
    })
    .filter((candidate): candidate is { amount: number; score: number; hasDateContext: boolean } => candidate.amount !== null && candidate.amount >= 0)
    .filter((candidate) => !looksLikeDateOrYear(candidate.amount, candidate.hasDateContext));

  if (!amounts.length) return null;
  amounts.sort((a, b) => b.score - a.score);
  return amounts[0].amount;
}

function hasExplicitZeroInvoiceTotal(text: string): boolean {
  return /(?:סה["״']?כ|סך\s*הכל|סכום\s*(?:לתשלום)?|לתשלום|total\s*(?:due|amount)?|amount\s*(?:due)?|balance\s*due|grand\s*total)[^\d₪$€]{0,40}(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)?\s*0(?:\s*(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur))?\b/i.test(
    text
  );
}

function collectMatches(text: string, pattern: RegExp, score: number, out: Array<{ raw: string; score: number; hasDateContext: boolean }>) {
  for (const match of text.matchAll(pattern)) {
    const raw = match.slice(1).find((group) => group && /\d/.test(group));
    if (raw) out.push({ raw, score, hasDateContext: hasDateOrYearContext(text, match.index ?? 0, match[0].length) });
  }
}

export { parseAmountOrNull as parseAmount } from "./amount/parseAmount.js";

function looksLikeDateOrYear(amount: number, hasDateContext: boolean) {
  return hasDateContext && Number.isInteger(amount) && amount >= 2020 && amount <= 2030;
}

function hasDateOrYearContext(text: string, matchIndex: number, rawLength: number) {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(text.length, matchIndex + rawLength + 30);
  const context = text.slice(start, end);
  return /(?:20\d{2}[-/.][01]?\d[-/.][0-3]?\d|[0-3]?\d[-/.][01]?\d[-/.]20\d{2}|תאריך|מועד|חודש|שנה|date|due|period|year|month)/i.test(context);
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
