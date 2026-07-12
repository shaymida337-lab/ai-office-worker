import { hebrewKeywordPattern } from "./hebrewMatch.js";

export type JunkFilterBucket = "CERTAIN_JUNK" | "UNSURE" | "REAL";

export type JunkFilterInput = {
  sender?: string | null;
  subject?: string | null;
  body?: string | null;
  channel?: "gmail" | "whatsapp" | string | null;
  attachmentFilenames?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type JunkFilterResult = {
  bucket: JunkFilterBucket;
  reason: string;
  blocklisted: boolean;
};

const TECH_PLATFORM_DOMAINS = [
  "render.com",
  "github.com",
  "vercel.com",
  "netlify.com",
  "cloudflare.com",
  "sentry.io",
];

const BLOCKLIST_TERMS = [
  /bank|בנק/i,
  /credit\s*card|כרטיס\s*אשראי|ישראכרט|ויזה|\bvisa\b|mastercard|amex|max\s*card|\bcal\b/i,
  /gov\.il|ממשלתי|רשות\s*המסים|ביטוח\s*לאומי/i,
];

const SYSTEM_ALERT_TERMS = [
  /security\s+alert|התראת\s+אבטחה/i,
  /sign[\s-]?in|login|כניסה\s+לחשבון/i,
  /build\s+failed|deployment|deploy(?:ment)?\s+(?:failed|succeeded)|פריסה/i,
  /your\s+service|service\s+notification/i,
  /password\s+reset|reset\s+your\s+password|איפוס\s+סיסמה/i,
  /verify\s+your\s+email|אמת(?:ו)?\s+את\s+האימייל/i,
];

const MARKETING_TERMS = [
  // \b על sale — אחרת "wholesale"/"sales invoice" נתפסים כשיווק
  /unsubscribe|newsletter|marketing|promotion|\bsale\b|discount|מבצע|ניוזלטר|הסר\s+מרשימת\s+התפוצה/i,
];

// התאמה על מילים שלמות בלבד. \b של JS הוא ASCII-בלבד ולא עובד לעברית,
// לכן המונחים העבריים עוברים דרך hebrewKeywordPattern: תחיליות (ה/ו/ב/ל/מ/ש/כ)
// מותרות — "הקבלה"/"מהחשבונית" נתפסים — אבל לא באמצע מילה ("התקבלה" לא).
const BUSINESS_DOCUMENT_TERMS = [
  /\binvoices?\b|\breceipts?\b|\bquotes?\b|\bpayment\s+requests?\b/i,
  hebrewKeywordPattern([
    "חשבוניות",
    "חשבונית",
    "קבלות",
    "קבלה",
    "הצעות\\s+מחיר",
    "הצעת\\s+מחיר",
    "דרישות\\s+תשלום",
    "דרישת\\s+תשלום",
  ]),
];

// "request" הותאם בעבר כתת-מחרוזת ולכן "Pull Request" סווג כ-REAL; גם
// כמילה שלמה "request" עדיין מופיע ב-"Pull Request" — לכן ההגנה האמיתית על
// מיילים של כלי פיתוח היא ה-blocklist של שולחים ב-invoiceCandidateGate,
// והמונחים כאן מוגבלים למילים שלמות כדי לא לתפוס reorder/border/helpful/quoted.
const CUSTOMER_ACTION_TERMS = [
  /\bplease\b|\bcan you\b|\bquotes?\b|\bproposals?\b|\bmeetings?\b|\borders?\b|\bhelp\b|\brequests?\b/i,
  hebrewKeywordPattern(["צריך", "אפשר", "הצעת\\s+מחיר", "פגישה", "הזמנה"]),
];

export function classifyJunk(input: JunkFilterInput): JunkFilterResult {
  const sender = input.sender?.trim() ?? "";
  const subject = input.subject?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  const combined = `${subject}\n${body}`;
  const attachmentNames = input.attachmentFilenames ?? [];
  const hasAttachment = attachmentNames.some(Boolean);
  const hasBusinessDocumentSignal = BUSINESS_DOCUMENT_TERMS.some((pattern) => pattern.test(combined) || attachmentNames.some((name) => pattern.test(name)));

  const blocklistReason = blocklistReasonFor(sender, combined);
  if (blocklistReason) {
    return { bucket: "UNSURE", reason: blocklistReason, blocklisted: true };
  }

  if (isTechnicalPlatformSender(sender) && SYSTEM_ALERT_TERMS.some((pattern) => pattern.test(combined))) {
    return { bucket: "CERTAIN_JUNK", reason: "technical_platform_system_notification", blocklisted: false };
  }

  if (isTechnicalPlatformSender(sender) && !hasBusinessDocumentSignal) {
    return { bucket: "CERTAIN_JUNK", reason: "technical_platform_no_business_document", blocklisted: false };
  }

  if (CUSTOMER_ACTION_TERMS.some((pattern) => pattern.test(combined))) {
    return { bucket: "REAL", reason: "customer_action_signal", blocklisted: false };
  }

  if (hasBusinessDocumentSignal && !isNoReplySender(sender)) {
    return { bucket: "REAL", reason: "business_document_signal", blocklisted: false };
  }

  if (isNoReplySender(sender) && SYSTEM_ALERT_TERMS.some((pattern) => pattern.test(combined))) {
    return { bucket: "CERTAIN_JUNK", reason: "no_reply_system_alert", blocklisted: false };
  }

  if (isPureMarketing(combined, hasAttachment)) {
    return { bucket: "CERTAIN_JUNK", reason: "pure_marketing_newsletter", blocklisted: false };
  }

  if (isNoReplySender(sender) || isTechnicalPlatformSender(sender)) {
    return { bucket: "UNSURE", reason: "automated_sender_without_business_document", blocklisted: false };
  }

  if (hasAttachment) {
    return { bucket: "UNSURE", reason: "unknown_sender_with_attachment", blocklisted: false };
  }

  return { bucket: "UNSURE", reason: "insufficient_signal", blocklisted: false };
}

export function shouldAutoClassifyAfterJunkFilter(result: JunkFilterResult) {
  return result.bucket === "REAL" && !result.blocklisted;
}

function isNoReplySender(sender: string) {
  const normalized = sender.toLowerCase();
  return /(^|[<\s])(no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|mailer-daemon)@/.test(normalized);
}

function isTechnicalPlatformSender(sender: string) {
  const normalized = sender.toLowerCase();
  return TECH_PLATFORM_DOMAINS.some((domain) => normalized.includes(`@${domain}`) || normalized.includes(`.${domain}`));
}

function blocklistReasonFor(sender: string, text: string) {
  if (BLOCKLIST_TERMS.some((pattern) => pattern.test(sender))) {
    return "blocklisted_financial_or_government_sender";
  }
  return null;
}

function isPureMarketing(text: string, hasAttachment: boolean) {
  if (hasAttachment || BUSINESS_DOCUMENT_TERMS.some((pattern) => pattern.test(text))) return false;
  return MARKETING_TERMS.some((pattern) => pattern.test(text));
}
