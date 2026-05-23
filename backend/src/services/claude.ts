import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "../lib/config.js";

export type EmailAnalysis = {
  supplier: string;
  amount: number | null;
  currency: string;
  documentType: "invoice" | "payment_request" | "receipt" | "other";
  paymentRequired: boolean;
  dueDate: string | null;
  tasks: string[];
  confidence: number;
};

export type InvoiceScanResult = {
  supplier: string;
  amount: number | null;
  date: string | null;
  invoiceNumber: string | null;
  currency: string;
};

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

const SYSTEM_PROMPT = `אתה עוזר הנהלת חשבונות לעסק ישראלי. נתח מיילים בעברית ואנגלית.
החזר אך ורק JSON תקין ללא markdown.

שדות:
{
  "supplier": "string",
  "amount": number|null,
  "currency": "ILS",
  "documentType": "invoice|payment_request|receipt|other",
  "paymentRequired": boolean,
  "dueDate": "YYYY-MM-DD"|null,
  "tasks": ["string"],
  "confidence": 0-1
}

אל תמציא סכומים. documentType: invoice=חשבונית, payment_request=דרישת תשלום.`;

export async function analyzeEmailContent(input: {
  subject: string;
  body: string;
  filenames: string[];
  sender?: string;
}): Promise<EmailAnalysis> {
  if (!anthropic) {
    return fallbackAnalysis(input);
  }

  const userContent = `שולח: ${input.sender ?? "לא ידוע"}
נושא: ${input.subject}
גוף: ${input.body.slice(0, 6000)}
קבצים: ${input.filenames.join(", ") || "אין"}`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? text) as EmailAnalysis;
  return {
    supplier: parsed.supplier || "לא ידוע",
    amount: parsed.amount ?? null,
    currency: parsed.currency || "ILS",
    documentType: parsed.documentType || "other",
    paymentRequired: Boolean(parsed.paymentRequired),
    dueDate: parsed.dueDate ?? null,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };
}

export async function analyzeInvoiceFile(input: {
  fileBase64: string;
  mimeType: string;
  filename?: string;
}): Promise<InvoiceScanResult> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const prompt =
    'חלץ מהחשבונית הזו: שם ספק, סכום, תאריך, מספר חשבונית, מטבע.\nהחזר JSON בלבד.';
  const fileBlock =
    input.mimeType === "application/pdf"
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: input.mimeType,
            data: input.fileBase64,
          },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: input.mimeType,
            data: input.fileBase64,
          },
        };

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: `${prompt}\nשם קובץ: ${input.filename ?? "לא ידוע"}`,
          },
        ] as any,
      },
    ],
  });

  const text =
    message.content[0]?.type === "text" ? message.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? text) as Record<string, unknown>;
  const supplier = firstString(parsed, ["supplier", "שם ספק", "ספק"]);
  const amount = firstNumber(parsed, ["amount", "סכום"]);
  const date = firstString(parsed, ["date", "תאריך", "invoiceDate", "תאריך חשבונית"]);
  const invoiceNumber = firstString(parsed, [
    "invoiceNumber",
    "invoice_number",
    "מספר חשבונית",
    "מספר",
  ]);
  const currency = firstString(parsed, ["currency", "מטבע"]);

  return {
    supplier: supplier || "לא ידוע",
    amount,
    date,
    invoiceNumber,
    currency: currency || "ILS",
  };
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
      const numeric = value.replace(/[^\d.]/g, "");
      if (!numeric) continue;
      const amount = Number(numeric);
      if (Number.isFinite(amount)) return amount;
    }
  }
  return null;
}

function fallbackAnalysis(input: {
  subject: string;
  body: string;
  filenames?: string[];
  sender?: string;
}): EmailAnalysis {
  const text = `${input.subject} ${input.body} ${(input.filenames ?? []).join(" ")}`.toLowerCase();
  const isReceipt = /קבלה|receipt|paid/.test(text);
  const isInvoice = /חשבונית|invoice|tax invoice/.test(text);
  const isPayment = /דרישת|בקשת תשלום|לתשלום|payment request|payment/.test(text);
  const amount = extractAmount(text);
  const dueDate = extractDueDate(text);
  const supplier = extractSupplier(input.sender) || "לא ידוע";

  return {
    supplier,
    amount,
    currency: "ILS",
    documentType: isReceipt
      ? "receipt"
      : isInvoice
      ? "invoice"
      : isPayment
        ? "payment_request"
        : "other",
    paymentRequired: isPayment,
    dueDate,
    tasks: [],
    confidence: amount || isInvoice || isPayment || isReceipt ? 0.55 : 0.25,
  };
}

function extractSupplier(sender?: string): string | null {
  if (!sender) return null;
  const displayName = sender.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim();
  if (displayName) return displayName;
  const emailName = sender.match(/([^@\s<]+)@/)?.[1]?.replace(/[._-]+/g, " ");
  return emailName || null;
}

function extractAmount(text: string): number | null {
  const match =
    text.match(/(?:₪|ils|nis)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i) ??
    text.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:₪|ils|nis)/i);
  if (!match?.[1]) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function extractDueDate(text: string): string | null {
  const match = text.match(/(?:עד|due|לתשלום עד)[^\d]*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i);
  if (!match) return null;
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${month}-${day}`;
}
