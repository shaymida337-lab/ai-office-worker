import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "../lib/config.js";
import { MAX_REASONABLE_FINANCIAL_AMOUNT } from "./financialAmountLimits.js";

export type EmailAnalysis = {
  supplier: string;
  supplierTaxId?: string | null;
  amount: number | null;
  amountBeforeVat?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
  currency: string;
  documentType: "invoice" | "tax_invoice_receipt" | "quote" | "payment_request" | "receipt" | "other";
  paymentRequired: boolean;
  dueDate: string | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  tasks: string[];
  confidence: number;
};

export type InvoiceScanResult = {
  supplier: string;
  supplierTaxId?: string | null;
  amount: number | null;
  amountBeforeVat?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
  date: string | null;
  dueDate?: string | null;
  invoiceNumber: string | null;
  documentType?: "invoice" | "tax_invoice_receipt" | "quote" | "payment_request" | "receipt" | "other";
  paymentRequired?: boolean;
  currency: string;
};

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const MAX_REASONABLE_AMOUNT = MAX_REASONABLE_FINANCIAL_AMOUNT;
const REFERENCE_NUMBER_CONTEXT =
  /(?:אסמכתא|מספר|שובר|סידורי|מסמך|חשבונית\s*(?:מס)?\s*מספר|ref|reference|invoice\s*(?:no|number)|order\s*(?:no|number)|#)/i;

const SYSTEM_PROMPT = `אתה עוזר הנהלת חשבונות לעסק ישראלי. נתח מיילים בעברית ואנגלית.
החזר אך ורק JSON תקין ללא markdown.

שדות:
{
  "supplier": "string",
  "supplierTaxId": "string|null",
  "amount": number|null,
  "amountBeforeVat": number|null,
  "vatAmount": number|null,
  "totalAmount": number|null,
  "currency": "ILS",
  "documentType": "invoice|tax_invoice_receipt|receipt|payment_request|quote|other",
  "paymentRequired": boolean,
  "dueDate": "YYYY-MM-DD"|null,
  "invoiceDate": "YYYY-MM-DD"|null,
  "invoiceNumber": "string"|null,
  "tasks": ["string"],
  "confidence": 0-1
}

אל תמציא סכומים, מספרי חשבונית או מספרי ח.פ/עוסק. supplier חייב להיות שם מנפיק החשבונית/העסק מתוך המסמך, לא כתובת אימייל ולא שם מקבל המייל. documentType: invoice=חשבונית מס, receipt=קבלה, tax_invoice_receipt=חשבונית מס קבלה, payment_request=דרישת תשלום, quote=הצעת מחיר, other=לא רלוונטי.
בקשות לתיאום פגישה, קביעת שעה או הזמנת תור הן משימות עסקיות אמיתיות ויש להחזיר עבורן פריט מתאים ב-tasks.
לתמוך בעברית ובאנגלית, כולל PDF/image OCR text שמופיע בגוף.`;

export type NatalieClaudeResponse =
  | { answer: string }
  | {
      action: "create_task";
      proposal: { title: string; dueDate?: string; notes?: string };
      answer: string;
    }
  | {
      action: "complete_task";
      proposal: { taskId: string; title: string };
      answer: string;
    }
  | {
      action: "show_invoice";
      invoices: Array<{
        id: string;
        supplierName: string | null;
        invoiceNumber: string | null;
        amount: number;
        currency: string;
        issueDate: string | Date;
        dueDate: string | Date | null;
        status: string;
        driveUrl: string | null;
      }>;
      answer: string;
    };

const NATALIE_BUSINESS_SYSTEM_PROMPT = `את נטלי, עוזרת משרדית חכמה לעסק ישראלי קטן.
עני בעברית, קצר וברור.
עני רק על בסיס מספרי העסק שסופקו לך בהקשר.
אם הנתונים שסופקו לא מכילים את התשובה, אמרי זאת בכנות בעברית ואל תמציאי מידע.

החזירי תמיד JSON תקין בלבד, ללא markdown:
לתשובה רגילה:
{"answer":"..."}
גם אם אין מה לדווח או לא נמצא מידע, החזירי JSON בלבד ולעולם אל תעני בטקסט חופשי מחוץ ל-JSON.
אם לא נמצא מידע: {"answer":"לא מצאתי מידע על כך בנתונים שסופקו לי."}

אם ורק אם המשתמש מבקש בבירור ליצור משימה או תזכורת, למשל "תזכיר לי", "תוסיפי משימה", "צריך לזכור":
{"action":"create_task","proposal":{"title":"כותרת משימה קצרה","dueDate":"YYYY-MM-DD","notes":"פרטים אופציונליים"},"answer":"אני אצור משימה: ... לאשר?"}

אם המשתמש מבקש לראות/להציג חשבונית קיימת, זו פעולה לקריאה בלבד. אין ליצור חשבונית חדשה. אם נתוני חשבוניות קיימות סופקו לך בהקשר, אפשר להחזיר:
{"action":"show_invoice","invoices":[{"id":"...","supplierName":"...","invoiceNumber":"...","amount":0,"currency":"ILS","issueDate":"YYYY-MM-DD","dueDate":null,"status":"pending","driveUrl":"..."}],"answer":"מצאתי ..."}

כללי פעולה:
- action="create_task" רק בבקשת משימה/תזכורת ברורה.
- action="show_invoice" רק להצגת חשבונית קיימת ורק אם נתוני החשבונית קיימים בהקשר.
- אל תיצרי משימה בפועל. רק הציעי.
- dueDate אופציונלי. אם אין תאריך ברור, השמיטו אותו.
- answer להצעת משימה חייב לציין בדיוק מה ייווצר ולהסתיים במילה "לאשר?".`;

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
    model: config.anthropic.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "{}";
  const parsed = parseJsonObject<EmailAnalysis>(text, "email analysis");
  if (!parsed) return fallbackAnalysis(input);
  return {
    supplier: parsed.supplier || "לא ידוע",
    supplierTaxId: typeof (parsed as { supplierTaxId?: unknown }).supplierTaxId === "string" ? (parsed as { supplierTaxId: string }).supplierTaxId : null,
    amount: normalizeAmountValue(parsed.amount),
    amountBeforeVat: normalizeAmountValue(parsed.amountBeforeVat),
    vatAmount: normalizeAmountValue(parsed.vatAmount),
    totalAmount: normalizeAmountValue(parsed.totalAmount) ?? normalizeAmountValue(parsed.amount),
    currency: parsed.currency || "ILS",
    documentType: normalizeEmailDocumentType(parsed.documentType),
    paymentRequired: Boolean(parsed.paymentRequired),
    dueDate: parsed.dueDate ?? null,
    invoiceDate: parsed.invoiceDate ?? null,
    invoiceNumber: parsed.invoiceNumber ?? null,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };
}

export async function answerBusinessQuestionWithClaude(input: {
  question: string;
  businessContext: unknown;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<NatalieClaudeResponse> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `מספרי העסק:\n${JSON.stringify(input.businessContext, null, 2)}`,
    },
    ...(input.history ?? []),
    {
      role: "user",
      content: `שאלת המשתמש:\n${input.question}`,
    },
  ];

  const message = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 500,
    system: NATALIE_BUSINESS_SYSTEM_PROMPT,
    messages,
  });

  const text = message.content[0]?.type === "text" ? message.content[0].text.trim() : "{}";
  const parsed = parseJsonObject<NatalieClaudeResponse>(text, "Natalie business answer");
  if (parsed && isNatalieClaudeResponse(parsed)) return parsed;
  return { answer: text || "לא הצלחתי לנסח תשובה כרגע." };
}

export async function analyzeInvoiceFile(input: {
  fileBase64: string;
  mimeType: string;
  filename?: string;
}): Promise<InvoiceScanResult> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const prompt = `חלץ מהמסמך המצורף את פרטי הנהלת החשבונות.
החזר JSON בלבד:
{
  "supplier": "שם ספק/מנפיק",
  "supplierTaxId": "ח.פ/עוסק|null",
  "amount": number|null,
  "amountBeforeVat": number|null,
  "vatAmount": number|null,
  "totalAmount": number|null,
  "date": "YYYY-MM-DD|null",
  "dueDate": "YYYY-MM-DD|null",
  "invoiceNumber": "string|null",
  "documentType": "invoice|tax_invoice_receipt|receipt|payment_request|quote|other",
  "paymentRequired": boolean,
  "currency": "ILS"
}
כללים חשובים:
- supplier הוא שם העסק/מנפיק החשבונית שמופיע בראש המסמך או ליד פרטי עוסק/ח.פ, לא שם הלקוח ולא "Unknown".
- amount הוא סה"כ לתשלום / סה"כ כולל מע"מ / Total Due. totalAmount זהה לסה"כ כולל מע"מ. amountBeforeVat הוא סכום לפני מע"מ. vatAmount הוא מע"מ. אל תחזיר סכום ביניים, מע"מ בלבד או מספר אסמכתא בשדה amount.
- invoiceNumber הוא מספר חשבונית/קבלה/מסמך בלבד, לא ח.פ/עוסק ולא מספר טלפון.
- אל תמציא ערכים. אם זה צילום של חשבונית/קבלה, בצע OCR מתוך התמונה.`;
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
    model: config.anthropic.model,
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
  const parsed = parseJsonObject<Record<string, unknown>>(text, "invoice scan");
  if (!parsed) {
    throw new Error("Claude did not return valid JSON for invoice scan");
  }
  const supplier = firstString(parsed, ["supplier", "שם ספק", "ספק"]);
  const supplierTaxId = firstString(parsed, ["supplierTaxId", "taxId", "vatNumber", "ח.פ", "עוסק מורשה", "מספר עוסק"]);
  const amount = firstNumber(parsed, ["amount", "total", "totalDue", "grandTotal", "balanceDue", "סכום", "סהכ", "סה\"כ", "סך הכל", "לתשלום"]);
  const amountBeforeVat = firstNumber(parsed, ["amountBeforeVat", "subtotal", "beforeVat", "netAmount", "סכום לפני מעמ", "סהכ לפני מעמ", "לפני מע\"מ"]);
  const vatAmount = firstNumber(parsed, ["vatAmount", "vat", "tax", "מע\"מ", "מעמ"]);
  const totalAmount = firstNumber(parsed, ["totalAmount", "amount", "total", "totalDue", "grandTotal", "balanceDue", "סהכ כולל מעמ", "סה\"כ כולל מע\"מ", "לתשלום"]);
  const date = firstString(parsed, ["date", "תאריך", "invoiceDate", "תאריך חשבונית"]);
  const dueDate = firstString(parsed, ["dueDate", "due_date", "תאריך יעד", "לתשלום עד"]);
  const invoiceNumber = firstString(parsed, [
    "invoiceNumber",
    "invoice_number",
    "מספר חשבונית",
    "מספר",
  ]);
  const currency = firstString(parsed, ["currency", "מטבע"]);
  const rawDocumentType = firstString(parsed, ["documentType", "document_type", "סוג מסמך"]);
  const documentType = normalizeDocumentType(rawDocumentType);

  return {
    supplier: supplier || "לא ידוע",
    supplierTaxId,
    amount,
    amountBeforeVat,
    vatAmount,
    totalAmount: totalAmount ?? amount,
    date,
    dueDate,
    invoiceNumber,
    documentType,
    paymentRequired: typeof parsed.paymentRequired === "boolean" ? parsed.paymentRequired : documentType !== "receipt",
    currency: currency || "ILS",
  };
}

function parseJsonObject<T>(text: string, context: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const objectMatch = text.match(/\{[\s\S]*\}/)?.[0];
  const candidate = fenced ?? objectMatch;
  if (!candidate) return null;

  try {
    return JSON.parse(candidate) as T;
  } catch (err) {
    const preview = text.slice(0, 200).replace(/\s+/g, " ");
    console.warn(`[claude] Invalid JSON for ${context}`, {
      error: err instanceof Error ? err.message : String(err),
      preview,
    });
    return null;
  }
}

function isNatalieClaudeResponse(value: unknown): value is NatalieClaudeResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  if (typeof response.answer !== "string" || !response.answer.trim()) return false;
  if (response.action === undefined) return true;
  if (response.action === "create_task") {
    const proposal = response.proposal as { title?: unknown; dueDate?: unknown; notes?: unknown } | undefined;
    if (!proposal || typeof proposal.title !== "string" || !proposal.title.trim()) return false;
    return (
      (proposal.dueDate === undefined || typeof proposal.dueDate === "string") &&
      (proposal.notes === undefined || typeof proposal.notes === "string")
    );
  }
  if (response.action === "complete_task") {
    const proposal = response.proposal as { taskId?: unknown; title?: unknown } | undefined;
    return Boolean(
      proposal &&
        typeof proposal.taskId === "string" &&
        proposal.taskId.trim() &&
        typeof proposal.title === "string" &&
        proposal.title.trim()
    );
  }
  if (response.action === "show_invoice") {
    return Array.isArray(response.invoices) && response.invoices.every(isNatalieInvoiceSummary);
  }
  return false;
}

function isNatalieInvoiceSummary(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const invoice = value as Record<string, unknown>;
  return (
    typeof invoice.id === "string" &&
    (invoice.supplierName === null || typeof invoice.supplierName === "string") &&
    (invoice.invoiceNumber === null || typeof invoice.invoiceNumber === "string") &&
    typeof invoice.amount === "number" &&
    typeof invoice.currency === "string" &&
    (typeof invoice.issueDate === "string" || invoice.issueDate instanceof Date) &&
    (invoice.dueDate === null || typeof invoice.dueDate === "string" || invoice.dueDate instanceof Date) &&
    typeof invoice.status === "string" &&
    (invoice.driveUrl === null || typeof invoice.driveUrl === "string")
  );
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
    if (typeof value === "number") {
      const amount = normalizeAmountValue(value);
      if (amount !== null) return amount;
    }
    if (typeof value === "string") {
      const amount = extractAmount(value);
      if (amount !== null) return amount;
    }
  }
  return null;
}

function normalizeDocumentType(value: string | null): InvoiceScanResult["documentType"] {
  const normalized = (value ?? "").toLowerCase();
  if (/tax_invoice_receipt|invoice\s+receipt|חשבונית\s*מס\s*קבלה/.test(normalized)) return "tax_invoice_receipt";
  if (/quote|proposal|estimate|הצעת\s*מחיר/.test(normalized)) return "quote";
  if (/receipt|קבלה/.test(normalized)) return "receipt";
  if (/payment|דרישת|בקשת/.test(normalized)) return "payment_request";
  if (/invoice|חשבונית/.test(normalized)) return "invoice";
  return "other";
}

function normalizeEmailDocumentType(value: unknown): EmailAnalysis["documentType"] {
  return normalizeDocumentType(typeof value === "string" ? value : null) ?? "other";
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
    supplierTaxId: extractSupplierTaxId(text),
    amount,
    amountBeforeVat: null,
    vatAmount: null,
    totalAmount: amount,
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
    invoiceDate: extractInvoiceDate(text),
    invoiceNumber: extractInvoiceNumber(text),
    tasks: [],
    confidence: amount || isInvoice || isPayment || isReceipt ? 0.55 : 0.25,
  };
}

function extractSupplierTaxId(text: string): string | null {
  const match = text.match(/(?:ח\.?פ\.?|חברה\s*מספר|עוסק\s*מורשה|מספר\s*עוסק|company\s*(?:id|number)|tax\s*id|vat\s*(?:id|number))[:\s#-]{0,20}([0-9]{7,10})/i);
  return match?.[1] ?? null;
}

function extractInvoiceDate(text: string): string | null {
  return extractDueDate(text);
}

function extractInvoiceNumber(text: string): string | null {
  const patterns = [
    /(?:invoice|receipt|חשבונית|קבלה|מספר)\s*(?:no\.?|number|#|מס׳|מספר)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
    /(?:inv|rcpt)[-_]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/[.,;:]+$/, "").slice(0, 80);
  }
  return null;
}

function extractSupplier(sender?: string): string | null {
  if (!sender) return null;
  const displayName = sender.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim();
  if (displayName) return displayName;
  const emailName = sender.match(/([^@\s<]+)@/)?.[1]?.replace(/[._-]+/g, " ");
  return emailName || null;
}

function extractAmount(text: string): number | null {
  const candidates: Array<{ raw: string; score: number }> = [];
  const normalized = text.replace(/&nbsp;/gi, " ").replace(/\u00a0/g, " ");
  collectAmountMatches(
    normalized,
    /(?:סה["״']?כ|סך\s*הכל|סכום\s*(?:לתשלום)?|לתשלום|total\s*(?:due|amount)?|amount\s*(?:due)?|balance\s*due)[^\d₪$€]{0,40}(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)?\s*([0-9][0-9.,\s]*)(?:\s*(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur))?/gi,
    100,
    candidates
  );
  collectAmountMatches(normalized, /(?:₪|ils|nis|ש["״']?ח)\s*([0-9][0-9.,\s]*)/gi, 80, candidates);
  collectAmountMatches(normalized, /([0-9][0-9.,\s]*)\s*(?:₪|ils|nis|ש["״']?ח)/gi, 80, candidates);

  const amounts = candidates
    .map((candidate) => ({ amount: parseAmount(candidate.raw), score: candidate.score }))
    .filter((candidate): candidate is { amount: number; score: number } => candidate.amount !== null && candidate.amount > 0)
    .filter((candidate) => !(Number.isInteger(candidate.amount) && candidate.amount >= 1900 && candidate.amount <= 2099));
  if (!amounts.length) return null;
  amounts.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return amounts[0].amount;
}

function collectAmountMatches(text: string, pattern: RegExp, score: number, out: Array<{ raw: string; score: number }>) {
  for (const match of text.matchAll(pattern)) {
    const raw = match.slice(1).find((group) => group && /\d/.test(group));
    if (raw && !hasReferenceNumberContext(text, match.index ?? 0, raw.length)) out.push({ raw, score });
  }
}

function hasReferenceNumberContext(text: string, matchIndex: number, rawLength: number) {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(text.length, matchIndex + rawLength + 30);
  return REFERENCE_NUMBER_CONTEXT.test(text.slice(start, end));
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : ".";
  let normalized = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    normalized = cleaned.replace(new RegExp(`\\${decimalSeparator === "," ? "." : ","}`, "g"), "").replace(decimalSeparator, ".");
  } else if (lastComma !== -1) {
    normalized = cleaned.length - lastComma - 1 === 2 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastDot !== -1) {
    normalized = cleaned.length - lastDot - 1 === 2 ? cleaned : cleaned.replace(/\./g, "");
  }
  const amount = Number(normalized);
  return isReasonableAmount(amount) ? amount : null;
}

function normalizeAmountValue(value: unknown): number | null {
  if (typeof value === "number") return isReasonableAmount(value) ? value : null;
  if (typeof value === "string") return extractAmount(value);
  return null;
}

function isReasonableAmount(amount: number) {
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_REASONABLE_AMOUNT;
}

function extractDueDate(text: string): string | null {
  const match = text.match(/(?:עד|due|לתשלום עד)[^\d]*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i);
  if (!match) return null;
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${month}-${day}`;
}
