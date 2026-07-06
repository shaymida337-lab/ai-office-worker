import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { QUALIFIED_LEAD_TAG, shouldCreateLeadFromMessageScan } from "./crm/leadQuality.js";
import { createCrmLead, handleLeadReply } from "./crm.js";
import { normalizeWhatsAppNumber } from "./whatsapp.js";
import { recordGmailCommunication } from "./communication/recordCommunicationTrace.js";

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

export type ScanChannel = "gmail" | "whatsapp";
export type ContactType = "lead" | "client" | "vendor" | "spam" | "other";
export type MessageIntent = "price_request" | "complaint" | "payment" | "question" | "other";
export type MessageSentiment = "positive" | "negative" | "neutral";
export type MessageUrgency = "high" | "normal";

export type MessageScanInput = {
  organizationId: string;
  channel: ScanChannel;
  externalId: string;
  emailMessageId?: string;
  whatsappLogId?: string;
  from?: string;
  senderName?: string;
  senderEmail?: string;
  senderPhone?: string;
  subject?: string;
  bodyText: string;
  occurredAt: Date;
  createLead?: boolean;
};

type AnalysisResult = {
  contactType: ContactType;
  intent: MessageIntent;
  sentiment: MessageSentiment;
  urgency: MessageUrgency;
  summary: string;
  confidence: number;
};

const SYSTEM_PROMPT = `אתה מנוע סריקה עסקי של AI Office Worker.
נתח הודעות Gmail ו-WhatsApp בעברית/אנגלית והחזר JSON בלבד, ללא markdown.

שדות חובה:
{
  "contactType": "lead|client|vendor|spam|other",
  "intent": "price_request|complaint|payment|question|other",
  "sentiment": "positive|negative|neutral",
  "urgency": "high|normal",
  "summary": "סיכום קצר בעברית",
  "confidence": 0-1
}

כללים:
- lead = פנייה חדשה, בקשת מחיר, התעניינות, שיחת מכירה.
- client = לקוח קיים או המשך עבודה.
- vendor = ספק, חשבונית, דרישת תשלום, קבלה.
- spam = פרסומי, ניוזלטר, רשתות חברתיות, ספאם.
- urgency high רק אם יש תלונה חריפה, דדליין, תשלום דחוף, "בהול", "urgent", "asap".`;

export async function analyzeAndSaveMessage(input: MessageScanInput) {
  if (input.channel === "gmail" && input.emailMessageId) {
    await recordGmailCommunication({
      organizationId: input.organizationId,
      gmailMessageId: input.externalId,
      emailMessageId: input.emailMessageId,
      from: input.from ?? input.senderEmail ?? "",
      subject: input.subject,
      bodyText: input.bodyText,
      occurredAt: input.occurredAt,
      correlationId: input.externalId,
    });
  }

  const cleanBody = cleanText(input.bodyText);
  const sender = normalizeSender(input);
  const existingClient = await findExistingClient(input.organizationId, sender.email, sender.phone);
  const analysis = await analyzeMessage({
    ...input,
    bodyText: cleanBody,
    senderEmail: sender.email ?? undefined,
    senderName: sender.name ?? undefined,
    senderPhone: sender.phone ?? undefined,
    existingClient: Boolean(existingClient),
  });

  const scan = await prisma.messageScan.upsert({
    where: {
      organizationId_channel_externalId: {
        organizationId: input.organizationId,
        channel: input.channel,
        externalId: input.externalId,
      },
    },
    create: {
      organizationId: input.organizationId,
      channel: input.channel,
      externalId: input.externalId,
      emailMessageId: input.emailMessageId,
      whatsappLogId: input.whatsappLogId,
      senderName: sender.name,
      senderEmail: sender.email,
      senderPhone: sender.phone,
      subject: input.subject,
      bodyText: cleanBody,
      occurredAt: input.occurredAt,
      contactType: analysis.contactType,
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      urgency: analysis.urgency,
      summary: analysis.summary,
      confidence: analysis.confidence,
      rawAnalysis: analysis,
    },
    update: {
      emailMessageId: input.emailMessageId,
      whatsappLogId: input.whatsappLogId,
      senderName: sender.name,
      senderEmail: sender.email,
      senderPhone: sender.phone,
      subject: input.subject,
      bodyText: cleanBody,
      occurredAt: input.occurredAt,
      contactType: analysis.contactType,
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      urgency: analysis.urgency,
      summary: analysis.summary,
      confidence: analysis.confidence,
      rawAnalysis: analysis,
    },
  });

  await applyScanSideEffects(input, sender, analysis, existingClient?.id ?? null);
  return scan;
}

export function extractPhone(text: string) {
  const match = text.match(/(?:\+972|0)(?:[-\s]?\d){8,10}/);
  return match?.[0]?.replace(/[\s-]/g, "") ?? null;
}

export function parseEmailSender(from = "") {
  const email = (from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "").toLowerCase();
  const name = from
    .replace(/<[^>]+>/g, "")
    .replace(/["']/g, "")
    .trim();
  return { name: name || null, email: email || null };
}

export function cleanText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20_000);
}

async function analyzeMessage(input: MessageScanInput & { existingClient: boolean }): Promise<AnalysisResult> {
  const fallback = fallbackAnalysis(input);
  if (!anthropic) return fallback;

  try {
    const message = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `ערוץ: ${input.channel}`,
            `לקוח קיים: ${input.existingClient ? "כן" : "לא"}`,
            `שולח: ${input.from ?? input.senderName ?? ""}`,
            `מייל: ${input.senderEmail ?? ""}`,
            `טלפון: ${input.senderPhone ?? ""}`,
            `נושא: ${input.subject ?? ""}`,
            `תוכן: ${input.bodyText.slice(0, 4000)}`,
          ].join("\n"),
        },
      ],
    });
    const text = message.content[0]?.type === "text" ? message.content[0].text : "{}";
    return normalizeAnalysis(parseJson(text), fallback);
  } catch (err) {
    console.warn("[message-scanner] AI analysis failed, using fallback", err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

function fallbackAnalysis(input: MessageScanInput & { existingClient?: boolean }): AnalysisResult {
  const text = `${input.subject ?? ""}\n${input.bodyText}`.toLowerCase();
  const isSpam = /unsubscribe|newsletter|promotion|מבצע|הסר מרשימת|פרסומת|facebook|linkedin|instagram/.test(text);
  const isPayment = /חשבונית|קבלה|דרישת תשלום|לתשלום|invoice|receipt|payment|bank transfer/.test(text);
  const isComplaint = /תלונה|לא מרוצה|בעיה|תקלה|דחוף|complaint|angry|issue|problem|urgent|asap/.test(text);
  const isPrice = /מחיר|הצעת מחיר|כמה עולה|פרטים|מעוניין|interested|price|quote|proposal|details/.test(text);
  const isQuestion = /\?|שאלה|אפשר|האם|question|can you|could you/.test(text);
  const urgency: MessageUrgency = /דחוף|בהול|מיידי|היום|urgent|asap|immediately|critical/.test(text) ? "high" : "normal";
  const sentiment: MessageSentiment = isComplaint ? "negative" : /תודה|מעולה|נשמע טוב|אשמח|great|thanks|thank you/.test(text) ? "positive" : "neutral";
  const intent: MessageIntent = isPrice ? "price_request" : isComplaint ? "complaint" : isPayment ? "payment" : isQuestion ? "question" : "other";
  const contactType: ContactType = isSpam
    ? "spam"
    : isPayment
      ? "vendor"
      : input.existingClient
        ? "client"
        : isPrice
          ? "lead"
          : "other";

  return {
    contactType,
    intent,
    sentiment,
    urgency,
    summary: buildFallbackSummary(input.subject, input.bodyText),
    confidence: isSpam || isPayment || isPrice || input.existingClient ? 0.72 : 0.45,
  };
}

async function applyScanSideEffects(
  input: MessageScanInput,
  sender: { name: string | null; email: string | null; phone: string | null },
  analysis: AnalysisResult,
  existingClientId: string | null
) {
  if (analysis.urgency === "high") {
    await prisma.alert.create({
      data: {
        organizationId: input.organizationId,
        type: "urgent_message",
        title: input.channel === "gmail" ? "מייל דחוף" : "WhatsApp דחוף",
        body: `${sender.name ?? sender.email ?? sender.phone ?? "שולח לא ידוע"}: ${analysis.summary}`,
      },
    });
  }

  if (input.channel === "whatsapp" && analysis.contactType === "client" && sender.phone) {
    await handleLeadReply(input.organizationId, { phone: sender.phone, message: input.bodyText, channel: "whatsapp" }).catch(() => undefined);
  }

  if (!input.createLead) return;
  if (!shouldCreateLeadFromMessageScan(analysis, {
    email: sender.email,
    name: sender.name,
    subject: input.subject,
    notes: input.bodyText,
  })) {
    return;
  }

  const existingLead = await prisma.lead.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [
        ...(sender.email ? [{ email: sender.email }] : []),
        ...(sender.phone ? [{ phone: sender.phone }, { whatsapp: sender.phone }] : []),
      ],
    },
  });
  if (existingLead || existingClientId) return;

  await createCrmLead(input.organizationId, {
    name: sender.name || sender.email || sender.phone || "ליד חדש",
    email: sender.email,
    phone: sender.phone,
    whatsapp: sender.phone,
    source: input.channel === "gmail" ? "email" : "whatsapp",
    tags: input.channel === "gmail" ? [QUALIFIED_LEAD_TAG] : undefined,
    notes: `${input.subject ?? ""}\n\n${input.bodyText}`.trim().slice(0, 1200),
  }, undefined, true).catch((err) => {
    console.warn("[message-scanner] lead creation failed", err instanceof Error ? err.message : String(err));
  });
}

async function findExistingClient(organizationId: string, email: string | null, phone: string | null) {
  const domain = email?.split("@")[1];
  return prisma.client.findFirst({
    where: {
      organizationId,
      isActive: true,
      OR: [
        ...(email ? [{ email }] : []),
        ...(domain ? [{ domain }] : []),
        ...(phone ? [{ whatsappNumber: normalizeWhatsAppNumber(phone) }, { whatsappNumber: phone }] : []),
      ],
    },
    select: { id: true },
  });
}

function normalizeSender(input: MessageScanInput) {
  const parsed = parseEmailSender(input.from);
  const bodyPhone = extractPhone(input.bodyText);
  const phone = input.senderPhone || bodyPhone;
  return {
    name: input.senderName || parsed.name,
    email: input.senderEmail || parsed.email,
    phone: phone ? normalizeWhatsAppNumber(phone) : null,
  };
}

function normalizeAnalysis(parsed: Record<string, unknown> | null, fallback: AnalysisResult): AnalysisResult {
  if (!parsed) return fallback;
  return {
    contactType: enumValue(parsed.contactType, ["lead", "client", "vendor", "spam", "other"], fallback.contactType),
    intent: enumValue(parsed.intent, ["price_request", "complaint", "payment", "question", "other"], fallback.intent),
    sentiment: enumValue(parsed.sentiment, ["positive", "negative", "neutral"], fallback.sentiment),
    urgency: enumValue(parsed.urgency, ["high", "normal"], fallback.urgency),
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim().slice(0, 500) : fallback.summary,
    confidence: typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : fallback.confidence,
  };
}

function parseJson(text: string) {
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function buildFallbackSummary(subject = "", body = "") {
  const text = cleanText(`${subject}\n${body}`).replace(/\s+/g, " ").trim();
  return text.slice(0, 180) || "הודעה ללא תוכן";
}
