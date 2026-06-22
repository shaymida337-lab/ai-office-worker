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
  ocrText?: string | null;
  ocrConfidence?: number | null;
};

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const MAX_REASONABLE_AMOUNT = MAX_REASONABLE_FINANCIAL_AMOUNT;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/heic", "image/heif"]);
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

אל תמציא סכומים, מספרי חשבונית או מספרי ח.פ/עוסק. אם לא נמצא סכום החזר null ולא 0. אם לא נמצא מספר חשבונית/חשבון החזר null ולעולם אל תחזיר "Number" או "Invoice". חפש במיוחד בעברית: "סהכ לתשלום", "סה״כ לתשלום", "סכום לתשלום", "מספר חשבונית", "חשבון", "תאריך", "מועד תשלום". supplier חייב להיות שם מנפיק החשבונית/העסק מתוך המסמך, לא כתובת אימייל ולא שם מקבל המייל. documentType: invoice=חשבונית מס, receipt=קבלה, tax_invoice_receipt=חשבונית מס קבלה, payment_request=דרישת תשלום, quote=הצעת מחיר, other=לא רלוונטי.
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
    }
  | {
      action: "issue_invoice";
      proposal: {
        customerName: string;
        customerTaxId?: string;
        customerEmail?: string;
        description: string;
        amount: number;
        currency?: string;
        issueDate?: string;
        dueDate?: string;
      };
      answer: string;
    }
  | {
      action: "book_appointment";
      proposal: {
        clientName: string;
        dayReference?: string;
        time?: string;
        startTime?: string;
        durationMinutes?: number;
        serviceName?: string;
        notes?: string;
      };
      answer: string;
    }
  | {
      action: "cancel_appointment";
      proposal: {
        appointmentId: string;
        clientName: string;
        when?: string;
        serviceName?: string;
      };
      answer: string;
    }
  | {
      action: "reschedule_appointment";
      proposal: {
        appointmentId: string;
        clientName: string;
        newDayReference?: string;
        newTime?: string;
        newWhen?: string;
      };
      answer: string;
    }
  | {
      action: "suggest_available_times";
      proposal: {
        slots: Array<{
          startTime: string;
          endTime: string;
          label: string;
          durationMinutes: number;
        }>;
        durationMinutes: number;
        rangeType?: "day" | "week";
        dayReference?: string;
        clientName?: string;
        intent: "suggest" | "first_available" | "check_alternatives";
        refreshParams: {
          rangeType?: "day" | "week";
          dayReference?: string;
          durationMinutes?: number;
          limit?: number;
        };
      };
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

אם ורק אם המשתמש מבקש במפורש להכין או להוציא חשבונית ללקוח, למשל "תכיני חשבונית ל...", "צריך להוציא חשבונית ל...", "תוציאי חשבונית ל...":
{"action":"issue_invoice","proposal":{"customerName":"...","customerEmail":"...","customerTaxId":"...","description":"...","amount":123.45,"currency":"ILS","issueDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD"},"answer":"אכין טיוטה: חשבונית ל[שם] על סך [סכום] ₪ עבור [תיאור]. זו טיוטה בלבד — לא תונפק חשבונית מס רשמית. לאשר?"}
אל תציעי issue_invoice על רמז עקיף כמו "הלקוח חייב לי כסף" או "לא שילמו לי" — במקרים כאלה עני רגיל בלי action.
שדות חובה ב-proposal: customerName, description, amount (מספר חיובי). customerEmail, customerTaxId, currency, issueDate, dueDate אופציונליים — אם המשתמש לא נתן אותם, השמיטי מה-proposal ואל תמציאי.
אם חסר שם לקוח או סכום, בקשי מהמשתמש בתשובה רגילה בלי action — אל תנחשי. לעולם אל תמציאי ח.פ או מספר עוסק של הלקוח.
answer להצעת טיוטת חשבונית חייב לציין בדיוק את שם הלקוח, הסכום והתיאור; לומר במפורש שזו טיוטה בלבד ושלא תונפק חשבונית מס רשמית; ולהסתיים במילה "לאשר?".
לעולם אל תאמרי שהנפקת, שלחת, או שהחשבונית מוכנה/הונפקה — רק מציעה ומכינה טיוטה פנימית.
בשלב זה נתמכת רק טיוטת חשבונית אחת בכל פעם. אם המשתמש מבקש כמה חשבוניות בבת אחת או מקובץ, עני שכרגע אפשר טיוטה אחת בכל פעם.

אם ורק אם המשתמש מבקש בבירור לקבוע או לרשום תור ללקוח, למשל "תקבעי תור ל...", "תרשמי תור ל...", "קבעי פגישה ל...":
{"action":"book_appointment","proposal":{"clientName":"שם הלקוח","dayReference":"יום שלישי","time":"10:00","durationMinutes":30,"serviceName":"שם השירות","notes":"הערות אופציונליות"},"answer":"אציע לקבוע תור ל[שם] ב[יום] בשעה [שעה] למשך [דקות] דקות. לאשר?"}
אל תציעי book_appointment על רמז עקיף — רק בבקשה מפורשת לקבוע/לרשום תור.
שדות חובה ב-proposal: clientName, dayReference, time. durationMinutes, serviceName, notes אופציונליים.
dayReference: בדיוק מה שהמשתמש אמר לגבי היום — "היום" / "מחר" / "מחרתיים" / "יום ראשון".."יום שבת" / או תאריך מפורש אם נאמר (למשל "23.6"). אל תחשבי תאריך מספרי בעצמך.
time: השעה שהמשתמש אמר בפורמט "HH:mm" (למשל "10:00").
אל תחשבי את התאריך המדויק בעצמך — רק העבירי מה שהמשתמש אמר. המערכת תחשב את התאריך.
durationMinutes חייב להיות מספר שלם בלי מרכאות ב-JSON — למשל 30 ולא "30".
אם חסר שם לקוח, יום או שעה — שאלי שאלת הבהרה בעברית בלי action. אל תנחשי.
לעולם אל תאמרי שקבעת תור בפועל — רק מציעה. answer חייב לנסח את ההצעה בעברית (יום + שעה כפי שהמשתמש אמר) ולהסתיים במילה "לאשר?".

אם המשתמש מבקש לראות/להציג חשבונית קיימת, זו פעולה לקריאה בלבד. אין ליצור חשבונית חדשה. אם נתוני חשבוניות קיימות סופקו לך בהקשר, אפשר להחזיר:
{"action":"show_invoice","invoices":[{"id":"...","supplierName":"...","invoiceNumber":"...","amount":0,"currency":"ILS","issueDate":"YYYY-MM-DD","dueDate":null,"status":"pending","driveUrl":"..."}],"answer":"מצאתי ..."}

כללי פעולה:
- action="create_task" רק בבקשת משימה/תזכורת ברורה.
- action="issue_invoice" רק בבקשה מפורשת להכין או להוציא חשבונית ללקוח, ורק כשיש customerName, description ו-amount חיובי שסופקו על ידי המשתמש.
- action="book_appointment" רק בבקשה מפורשת לקבוע או לרשום תור, ורק כשיש clientName, dayReference ו-time שסופקו על ידי המשתמש.
- action="show_invoice" רק להצגת חשבונית קיימת ורק אם נתוני החשבונית קיימים בהקשר.
- אל תיצרי משימה בפועל. רק הציעי.
- אל תיצרי חשבונית בפועל. רק הציעי טיוטה פנימית.
- אל תקבעי תור בפועל. רק הציעי.
- dueDate אופציונלי. אם אין תאריך ברור, השמיטו אותו.
- answer להצעת משימה חייב לציין בדיוק מה ייווצר ולהסתיים במילה "לאשר?".
- answer להצעת טיוטת חשבונית חייב לציין בדיוק מה תהיה הטיוטה, לומר במפורש שזו טיוטה בלבד ושלא תונפק חשבונית מס רשמית, ולהסתיים במילה "לאשר?".
- answer להצעת תור חייב לציין בדיוק ללקוח מי, מתי, ולכמה זמן (אם ידוע), ולהסתיים במילה "לאשר?".`;

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
    invoiceNumber: normalizeInvoiceNumberValue(parsed.invoiceNumber),
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

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const finalMessage = await anthropic.messages.create(
        {
          model: config.anthropic.model,
          max_tokens: 500,
          system: NATALIE_BUSINESS_SYSTEM_PROMPT,
          messages,
        },
        {
          maxRetries: 4,
          timeout: 60000,
        }
      );
      const firstBlock = finalMessage.content[0];
      const text = firstBlock?.type === "text" ? firstBlock.text.trim() : "{}";
      const parsed = parseJsonObject<NatalieClaudeResponse>(text, "Natalie business answer");
      if (parsed && isNatalieClaudeResponse(parsed)) return parsed;
      return { answer: text || "לא הצלחתי לנסח תשובה כרגע." };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      const looksLikeDisconnect = ["premature close", "premature", "econnreset", "socket", "terminated", "network", "fetch failed"].some((s) =>
        msg.includes(s)
      );
      if (!looksLikeDisconnect || attempt >= 3) throw err;
      console.warn(`[natalie] Claude stream disconnect attempt=${attempt} reason="${err instanceof Error ? err.message : String(err)}"`);
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

export async function analyzeInvoiceFile(input: {
  fileBase64: string;
  mimeType: string;
  filename?: string;
}): Promise<InvoiceScanResult> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const prepared = isImageMimeType(input.mimeType)
    ? await prepareImageForOcr(input.fileBase64, input.mimeType, input.filename)
    : {
        fileBase64: input.fileBase64,
        mimeType: input.mimeType,
        preprocessingNotes: "not_image",
        ocrText: null,
        ocrConfidence: null,
      };

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
- אם OCR בעברית/אנגלית מזהה ספק ברור, החזר אותו כפי שמופיע ברשימה: "חברת החשמל" עבור "חברת החשמל"/"חברת החשמל לישראל"/Israel Electric; "מי רמת גן" עבור "מי רמת גן"/"מי-רמת-גן"/"תאגיד מי רמת גן"; "הולילנד" עבור "הולילנד"/Holyland; "סופר פארם" עבור "סופר פארם"/"סופר-פארם"/Super-Pharm; "וולט" עבור "וולט"/Wolt.
- amount הוא סה"כ לתשלום / סה"כ כולל מע"מ / Total Due / סכום לתשלום. totalAmount זהה לסה"כ כולל מע"מ. amountBeforeVat הוא סכום לפני מע"מ. vatAmount הוא מע"מ. אל תחזיר סכום ביניים, מע"מ בלבד, מספר חשבון או מספר אסמכתא בשדה amount. אם אין סכום ברור החזר null ולא 0.
- invoiceNumber הוא מספר חשבונית/קבלה/מסמך בלבד; אם אין מספר חשבונית, מספר חשבון מותר כשזה המזהה היחיד של חשבון תקופתי. לא ח.פ/עוסק ולא מספר טלפון. לעולם אל תחזיר "Number" או "Invoice".
- אל תמציא ערכים. אם זה צילום של חשבונית/קבלה, בצע OCR מתוך התמונה.
- התמונה, אם קיימת, עברה הכנה ל-OCR: auto-rotate לפי metadata, auto-crop לשוליים בהירים, normalize/contrast, shadow reduction ושיפור חדות.
- תמוך בעברית משולבת במספרים, כולל סכום, מספר חשבון, מספר חשבונית ותאריך יעד.
${prepared.ocrText ? `\nטקסט OCR מקדים מ-Tesseract (heb+eng), השתמש בו רק אם הוא מתאים למסמך:\n${prepared.ocrText.slice(0, 5000)}` : ""}`;
  const fileBlock =
    prepared.mimeType === "application/pdf"
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: prepared.mimeType,
            data: prepared.fileBase64,
          },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: prepared.mimeType,
            data: prepared.fileBase64,
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
            text: `${prompt}\nשם קובץ: ${input.filename ?? "לא ידוע"}\npreprocessing=${prepared.preprocessingNotes}`,
          },
        ] as any,
      },
    ],
  });

  const text =
    message.content[0]?.type === "text" ? message.content[0].text : "{}";
  console.log(`[claude] RAW invoice OCR response: ${text.slice(0, 1500)}`);
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
  const invoiceNumber = normalizeInvoiceNumberValue(firstString(parsed, [
    "invoiceNumber",
    "invoice_number",
    "מספר חשבונית",
    "מספר",
  ]));
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
    ocrText: prepared.ocrText,
    ocrConfidence: prepared.ocrConfidence,
  };
}

async function prepareImageForOcr(fileBase64: string, mimeType: string, filename?: string) {
  const originalBuffer = Buffer.from(fileBase64, "base64");
  let processedBuffer: Buffer<ArrayBufferLike> = originalBuffer;
  let processedMimeType = normalizeImageMimeType(mimeType) ?? "image/jpeg";
  let preprocessingNotes = "original_image";

  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    processedBuffer = await sharp(originalBuffer, { limitInputPixels: false })
      .rotate()
      .trim({ background: "#ffffff", threshold: 12 })
      .grayscale()
      .normalize()
      .linear(1.18, -12)
      .sharpen({ sigma: 1.1, m1: 1.2, m2: 0.6 })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    processedMimeType = "image/jpeg";
    preprocessingNotes = "sharp:auto_rotate,auto_crop,grayscale,contrast_boost,shadow_reduction,sharpen";
  } catch (err) {
    preprocessingNotes = `preprocess_failed:${err instanceof Error ? err.message : String(err)}`.slice(0, 180);
    console.warn(`[claude] Image preprocessing failed for ${filename ?? "image"}`, err instanceof Error ? err.message : String(err));
  }

  const ocr = await recognizeHebrewImageText(processedBuffer, filename);
  return {
    fileBase64: processedBuffer.toString("base64"),
    mimeType: processedMimeType,
    preprocessingNotes,
    ocrText: ocr?.text ?? null,
    ocrConfidence: ocr?.confidence ?? null,
  };
}

async function recognizeHebrewImageText(buffer: Buffer, filename?: string) {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("heb+eng");
    try {
      const result = await worker.recognize(buffer);
      const text = result.data.text?.replace(/\s+/g, " ").trim() ?? "";
      if (!text) return null;
      const confidence = typeof result.data.confidence === "number" ? result.data.confidence / 100 : null;
      console.log(`[claude] OCR_TEXT_EXTRACTED source=tesseract_heb_eng file="${filename ?? "image"}" confidence=${confidence ?? "unknown"} text="${truncateForLog(text)}"`);
      return { text, confidence };
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    console.warn(`[claude] Tesseract OCR failed for ${filename ?? "image"}`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

function isImageMimeType(mimeType: string) {
  return IMAGE_MIME_TYPES.has(mimeType.split(";")[0]?.trim().toLowerCase());
}

function normalizeImageMimeType(mimeType: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/jpg" || normalized === "image/pjpeg") return "image/jpeg";
  return IMAGE_MIME_TYPES.has(normalized) ? normalized : null;
}

function truncateForLog(text: string, limit = 900) {
  return text.replace(/\s+/g, " ").slice(0, limit).replace(/"/g, "'");
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

function normalizeOptionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeBookAppointmentProposal(response: Record<string, unknown>): void {
  if (response.action !== "book_appointment" || !response.proposal || typeof response.proposal !== "object") return;

  const proposal = response.proposal as Record<string, unknown>;
  const clientName = normalizeOptionalString(proposal.clientName);
  if (clientName !== undefined) proposal.clientName = clientName;

  const dayReference = normalizeOptionalString(proposal.dayReference);
  if (dayReference !== undefined) proposal.dayReference = dayReference;
  else delete proposal.dayReference;

  const time = normalizeOptionalString(proposal.time);
  if (time !== undefined) proposal.time = time;
  else delete proposal.time;

  const startTime = normalizeOptionalString(proposal.startTime);
  if (startTime !== undefined) proposal.startTime = startTime;
  else delete proposal.startTime;

  const durationMinutes = normalizeOptionalPositiveNumber(proposal.durationMinutes);
  if (durationMinutes !== undefined) proposal.durationMinutes = durationMinutes;
  else delete proposal.durationMinutes;

  const serviceName = normalizeOptionalString(proposal.serviceName);
  if (serviceName !== undefined) proposal.serviceName = serviceName;
  else delete proposal.serviceName;

  const notes = normalizeOptionalString(proposal.notes);
  if (notes !== undefined) proposal.notes = notes;
  else delete proposal.notes;
}

function validateBookAppointmentResponse(response: Record<string, unknown>): boolean {
  normalizeBookAppointmentProposal(response);

  const proposal = response.proposal as {
    clientName?: unknown;
    dayReference?: unknown;
    time?: unknown;
    startTime?: unknown;
    durationMinutes?: unknown;
    serviceName?: unknown;
    notes?: unknown;
  } | undefined;

  if (!proposal || typeof proposal !== "object") {
    console.warn("[natalie] book_appointment validation failed: proposal missing or not an object");
    return false;
  }
  if (typeof proposal.clientName !== "string" || !proposal.clientName.trim()) {
    console.warn("[natalie] book_appointment validation failed: clientName missing or empty", {
      clientName: proposal.clientName,
    });
    return false;
  }

  const hasDayAndTime =
    typeof proposal.dayReference === "string" &&
    proposal.dayReference.trim() &&
    typeof proposal.time === "string" &&
    proposal.time.trim();
  const hasExplicitStartTime = typeof proposal.startTime === "string" && proposal.startTime.trim();

  if (!hasDayAndTime && !hasExplicitStartTime) {
    console.warn("[natalie] book_appointment validation failed: missing dayReference+time or startTime", {
      dayReference: proposal.dayReference,
      time: proposal.time,
      startTime: proposal.startTime,
    });
    return false;
  }

  if (proposal.dayReference !== undefined && typeof proposal.dayReference !== "string") {
    console.warn("[natalie] book_appointment validation failed: dayReference invalid", {
      dayReference: proposal.dayReference,
    });
    return false;
  }
  if (proposal.time !== undefined && typeof proposal.time !== "string") {
    console.warn("[natalie] book_appointment validation failed: time invalid", {
      time: proposal.time,
    });
    return false;
  }
  if (proposal.startTime !== undefined && typeof proposal.startTime !== "string") {
    console.warn("[natalie] book_appointment validation failed: startTime invalid", {
      startTime: proposal.startTime,
    });
    return false;
  }
  if (
    proposal.durationMinutes !== undefined &&
    (typeof proposal.durationMinutes !== "number" ||
      !Number.isFinite(proposal.durationMinutes) ||
      proposal.durationMinutes <= 0)
  ) {
    console.warn("[natalie] book_appointment validation failed: durationMinutes invalid after normalization", {
      durationMinutes: proposal.durationMinutes,
    });
    return false;
  }
  if (proposal.serviceName !== undefined && typeof proposal.serviceName !== "string") {
    console.warn("[natalie] book_appointment validation failed: serviceName invalid", {
      serviceName: proposal.serviceName,
    });
    return false;
  }
  if (proposal.notes !== undefined && typeof proposal.notes !== "string") {
    console.warn("[natalie] book_appointment validation failed: notes invalid", {
      notes: proposal.notes,
    });
    return false;
  }
  return true;
}

export function isNatalieClaudeResponse(value: unknown): value is NatalieClaudeResponse {
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
  if (response.action === "issue_invoice") {
    const proposal = response.proposal as {
      customerName?: unknown;
      customerTaxId?: unknown;
      customerEmail?: unknown;
      description?: unknown;
      amount?: unknown;
      currency?: unknown;
      issueDate?: unknown;
      dueDate?: unknown;
    } | undefined;
    if (!proposal || typeof proposal.customerName !== "string" || !proposal.customerName.trim()) return false;
    if (typeof proposal.description !== "string" || !proposal.description.trim()) return false;
    if (typeof proposal.amount !== "number" || !Number.isFinite(proposal.amount) || proposal.amount <= 0) return false;
    if (proposal.customerTaxId !== undefined && typeof proposal.customerTaxId !== "string") return false;
    if (proposal.customerEmail !== undefined && typeof proposal.customerEmail !== "string") return false;
    if (proposal.currency !== undefined && typeof proposal.currency !== "string") return false;
    if (proposal.issueDate !== undefined && typeof proposal.issueDate !== "string") return false;
    if (proposal.dueDate !== undefined && typeof proposal.dueDate !== "string") return false;
    return true;
  }
  if (response.action === "book_appointment") {
    return validateBookAppointmentResponse(response);
  }
  if (response.action === "cancel_appointment") {
    const proposal = response.proposal as {
      appointmentId?: unknown;
      clientName?: unknown;
      when?: unknown;
      serviceName?: unknown;
    } | undefined;
    return Boolean(
      proposal &&
        typeof proposal.appointmentId === "string" &&
        proposal.appointmentId.trim() &&
        typeof proposal.clientName === "string" &&
        proposal.clientName.trim() &&
        (proposal.when === undefined || typeof proposal.when === "string") &&
        (proposal.serviceName === undefined || typeof proposal.serviceName === "string")
    );
  }
  if (response.action === "reschedule_appointment") {
    const proposal = response.proposal as {
      appointmentId?: unknown;
      clientName?: unknown;
      newDayReference?: unknown;
      newTime?: unknown;
      newWhen?: unknown;
    } | undefined;
    return Boolean(
      proposal &&
        typeof proposal.appointmentId === "string" &&
        proposal.appointmentId.trim() &&
        typeof proposal.clientName === "string" &&
        proposal.clientName.trim() &&
        (proposal.newDayReference === undefined || typeof proposal.newDayReference === "string") &&
        (proposal.newTime === undefined || typeof proposal.newTime === "string") &&
        (proposal.newWhen === undefined || typeof proposal.newWhen === "string")
    );
  }
  if (response.action === "suggest_available_times") {
    const proposal = response.proposal as {
      slots?: unknown;
      durationMinutes?: unknown;
      intent?: unknown;
      refreshParams?: unknown;
    } | undefined;
    if (!proposal || typeof proposal !== "object") return false;
    if (typeof proposal.durationMinutes !== "number" || !Number.isFinite(proposal.durationMinutes)) return false;
    if (
      proposal.intent !== "suggest" &&
      proposal.intent !== "first_available" &&
      proposal.intent !== "check_alternatives"
    ) {
      return false;
    }
    if (!proposal.refreshParams || typeof proposal.refreshParams !== "object") return false;
    if (!Array.isArray(proposal.slots) || proposal.slots.length === 0) return false;
    return proposal.slots.every((slot) => {
      if (!slot || typeof slot !== "object") return false;
      const item = slot as Record<string, unknown>;
      return (
        typeof item.startTime === "string" &&
        item.startTime.trim() &&
        typeof item.endTime === "string" &&
        item.endTime.trim() &&
        typeof item.label === "string" &&
        item.label.trim() &&
        typeof item.durationMinutes === "number" &&
        Number.isFinite(item.durationMinutes)
      );
    });
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

function normalizeInvoiceNumberValue(value: unknown): string | null {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string"
      ? value.trim()
      : "";
  const cleaned = raw.replace(/[.,;:]+$/, "").trim().slice(0, 80);
  if (!cleaned) return null;
  if (/^(?:number|invoice|receipt|no|מספר|חשבונית|חשבון|קבלה)$/iu.test(cleaned)) return null;
  if (!/[0-9]/.test(cleaned) && cleaned.length < 4) return null;
  return cleaned;
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
    /\b(?:inv|rcpt)[-_\s]+([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const invoiceNumber = normalizeInvoiceNumberValue(match?.[1]);
    if (invoiceNumber) return invoiceNumber;
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
  const candidates: Array<{ raw: string; score: number; hasDateContext: boolean }> = [];
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
    .map((candidate) => ({ amount: parseAmount(candidate.raw), score: candidate.score, hasDateContext: candidate.hasDateContext }))
    .filter((candidate): candidate is { amount: number; score: number; hasDateContext: boolean } => candidate.amount !== null && candidate.amount > 0)
    .filter((candidate) => !looksLikeDateOrYear(candidate.amount, candidate.hasDateContext));
  if (!amounts.length) return null;
  amounts.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return amounts[0].amount;
}

function collectAmountMatches(text: string, pattern: RegExp, score: number, out: Array<{ raw: string; score: number; hasDateContext: boolean }>) {
  for (const match of text.matchAll(pattern)) {
    const raw = match.slice(1).find((group) => group && /\d/.test(group));
    if (raw && !hasReferenceNumberContext(text, match.index ?? 0, raw.length)) {
      out.push({ raw, score, hasDateContext: hasDateOrYearContext(text, match.index ?? 0, match[0].length) });
    }
  }
}

function hasReferenceNumberContext(text: string, matchIndex: number, rawLength: number) {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(text.length, matchIndex + rawLength + 30);
  return REFERENCE_NUMBER_CONTEXT.test(text.slice(start, end));
}

function looksLikeDateOrYear(amount: number, hasDateContext: boolean) {
  return hasDateContext && Number.isInteger(amount) && amount >= 2020 && amount <= 2030;
}

function hasDateOrYearContext(text: string, matchIndex: number, rawLength: number) {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(text.length, matchIndex + rawLength + 30);
  const context = text.slice(start, end);
  return /(?:20\d{2}[-/.][01]?\d[-/.][0-3]?\d|[0-3]?\d[-/.][01]?\d[-/.]20\d{2}|תאריך|מועד|חודש|שנה|date|due|period|year|month)/i.test(context);
}

export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
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
    const decimals = cleaned.length - lastDot - 1;
    normalized = decimals >= 1 && decimals <= 2 ? cleaned : cleaned.replace(/\./g, "");
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
  return Number.isFinite(amount) && amount > 0 && amount < MAX_REASONABLE_AMOUNT;
}

function extractDueDate(text: string): string | null {
  const match = text.match(/(?:עד|due|לתשלום עד)[^\d]*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i);
  if (!match) return null;
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${month}-${day}`;
}
