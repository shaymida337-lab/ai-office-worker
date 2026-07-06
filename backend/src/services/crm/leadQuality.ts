import type { Prisma } from "@prisma/client";
import type { ContactType, MessageIntent } from "../messageScanner.js";

export const QUALIFIED_LEAD_TAG = "qualified";
export const MIN_SALES_LEAD_CONFIDENCE = 0.65;

const JUNK_EMAIL_LOCAL_RE =
  /(?:^|[.+_-])(?:noreply|no-?reply|donotreply|do-?not-?reply|notifications?|mailer-daemon|invoice|billing|receipt|statements?|tickets?|eticket|newsletter|unsubscribe|support)(?:@|[.+_-]|$)/i;

const JUNK_SENDER_TEXT_RE =
  /\b(?:invoice|billing|receipt|statement|notification|newsletter|unsubscribe|ticket|eticket|payment due|חשבונית|קבלה|דרישת תשלום|מבצע|פרסומת)\b/i;

const TRAVEL_SENDER_RE =
  /\b(?:lion\s*air|mytrip|go-?out|wolt|netlify|anthropic|openai|otter\.ai|wordpress\.com|responder\.co\.il|lcmsgsndr)\b/i;

const SYSTEM_NOTIFICATION_RE =
  /\b(?:acquire notifications|carsales|lesfrancais)\b/i;

export type LeadLike = {
  source?: string | null;
  email?: string | null;
  name?: string | null;
  company?: string | null;
  assignedTo?: string | null;
  tags?: string[] | null;
  notes?: string | null;
};

export type LeadSenderLike = {
  email?: string | null;
  name?: string | null;
  subject?: string | null;
  notes?: string | null;
};

export type LeadScanAnalysis = {
  contactType: ContactType;
  intent: MessageIntent;
  confidence: number;
};

export function isJunkLeadEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  return JUNK_EMAIL_LOCAL_RE.test(normalized);
}

export function isJunkLeadSender(input: LeadSenderLike): boolean {
  const haystack = [input.email, input.name, input.subject, input.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) return false;
  if (input.email && isJunkLeadEmail(input.email)) return true;
  if (JUNK_SENDER_TEXT_RE.test(haystack)) return true;
  if (TRAVEL_SENDER_RE.test(haystack)) return true;
  if (SYSTEM_NOTIFICATION_RE.test(haystack)) return true;
  return false;
}

export function isQualifiedEmailLead(lead: LeadLike): boolean {
  if (lead.source !== "email") return true;
  if (lead.assignedTo) return true;
  if (lead.tags?.includes(QUALIFIED_LEAD_TAG)) return true;
  return false;
}

export function isUnqualifiedEmailLead(lead: LeadLike): boolean {
  return lead.source === "email" && !isQualifiedEmailLead(lead);
}

export function isRealBusinessLead(lead: LeadLike): boolean {
  if (isUnqualifiedEmailLead(lead)) return false;
  if (isJunkLeadSender({ email: lead.email, name: lead.name ?? lead.company, notes: lead.notes })) return false;
  return true;
}

export function shouldCreateLeadFromMessageScan(
  analysis: LeadScanAnalysis,
  sender: LeadSenderLike
): boolean {
  if (analysis.contactType === "vendor" || analysis.contactType === "spam") return false;
  if (analysis.contactType !== "lead") return false;
  if (analysis.intent === "payment") return false;
  if (analysis.confidence < MIN_SALES_LEAD_CONFIDENCE) return false;
  if (isJunkLeadSender(sender)) return false;
  return true;
}

export function shouldCreateLeadFromGmailEmail(input: LeadSenderLike): boolean {
  if (isJunkLeadSender(input)) return false;
  return false;
}

function buildUnqualifiedEmailLeadWhere(): Prisma.LeadWhereInput {
  return {
    AND: [
      { source: "email" },
      { assignedTo: null },
      { NOT: { tags: { has: QUALIFIED_LEAD_TAG } } },
    ],
  };
}

const JUNK_EMAIL_CONTAINS = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "invoice+",
  "invoice@",
  "billing",
  "receipt",
  "statement",
  "notifications@",
  "tickets-noreply",
  "eticket",
  "newsletter",
  "unsubscribe",
] as const;

function buildJunkEmailPatternWheres(): Prisma.LeadWhereInput[] {
  return JUNK_EMAIL_CONTAINS.map((pattern) => ({
    email: { contains: pattern, mode: "insensitive" as const },
  }));
}

const JUNK_NAME_CONTAINS = [
  "invoice",
  "billing",
  "receipt",
  "statement",
  "notification",
  "newsletter",
  "ticket",
  "noreply",
  "anthropic",
  "openai",
  "netlify",
  "wolt",
] as const;

function buildJunkNamePatternWheres(): Prisma.LeadWhereInput[] {
  return JUNK_NAME_CONTAINS.flatMap((pattern) => [
    { name: { contains: pattern, mode: "insensitive" as const } },
    { company: { contains: pattern, mode: "insensitive" as const } },
  ]);
}

export function buildRealLeadQualityWhere(): Prisma.LeadWhereInput {
  return {
    NOT: {
      OR: [
        buildUnqualifiedEmailLeadWhere(),
        ...buildJunkEmailPatternWheres(),
        ...buildJunkNamePatternWheres(),
      ],
    },
  };
}

export function buildStaleLeadBaseWhere(organizationId: string, staleBefore: Date): Prisma.LeadWhereInput {
  return {
    organizationId,
    repliedAt: null,
    stage: { notIn: ["סגור", "הפסד"] },
    OR: [{ lastContactAt: null }, { lastContactAt: { lt: staleBefore } }],
  };
}

export function buildRealStaleLeadWhere(organizationId: string, staleBefore: Date): Prisma.LeadWhereInput {
  return {
    AND: [buildStaleLeadBaseWhere(organizationId, staleBefore), buildRealLeadQualityWhere()],
  };
}
