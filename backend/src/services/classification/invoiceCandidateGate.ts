/**
 * שער סיווג חשבונית שרץ *לפני* קריאת המודל (analyzeEmailContent).
 *
 * עד עכשיו הדבר היחיד שעמד בין מייל סרוק לבין מנוע החילוץ היה פילטר הזבל —
 * detectInvoice / classifyGmailScanCandidate רצים רק *אחרי* שהמודל כבר נקרא,
 * והם מסמנים needs_review במקום לחסום. התוצאה: התראות GitHub נכנסו למערכת
 * וקיבלו ספק וסכום מומצאים.
 *
 * עיקרון: מייל שהשער לא מזהה בו שום אות פיננסי לא נקלט בכלל — לא נשלח
 * למודל ולא נרשם כ-needs_review. חסימה מתועדת בלוג כדי לאתר false negatives.
 *
 * קריטי — לא לחסום חשבוניות אמיתיות: מילת מפתח פיננסית חזקה גוברת על כל
 * חסימה (קבלות של GitHub/Google נשלחות מאותם דומיינים של ההתראות), וצירוף
 * מסמך (PDF/תמונה/Office) תמיד מכניס — חשבוניות רבות מגיעות עם גוף ריק.
 */

import { hebrewKeywordPattern } from "./hebrewMatch.js";

export type InvoiceCandidateResult = {
  isInvoice: boolean;
  confidence: number;
  reasons: string[];
};

export type InvoiceCandidateInput = {
  sender?: string | null;
  subject?: string | null;
  body?: string | null;
  attachmentFilenames?: string[] | null;
};

// שולחים/דומיינים של כלי פיתוח וניהול שלעולם אינם שולחים חשבוניות של
// ספקים אמיתיים — למעט קבלות על המנוי שלהם עצמו, שמכילות תמיד מילת מפתח
// פיננסית ולכן עוברות דרך ה-override של STRONG_FINANCIAL_KEYWORDS.
const NEVER_FINANCIAL_SENDER_DOMAINS = [
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "atlassian.com",
  "atlassian.net",
  "slack.com",
  "sentry.io",
  "render.com",
  "vercel.com",
  "netlify.com",
  "cloudflare.com",
  "npmjs.com",
  "circleci.com",
  "travis-ci.com",
  "dependabot.com",
  "linear.app",
  "notion.so",
  "figma.com",
  "trello.com",
  "asana.com",
  "monday.com",
];

// שולחים ספציפיים שאינם פיננסיים לעולם — בלי לחסום את google.com כולו,
// כי Google Billing (payments-noreply@google.com) שולח קבלות אמיתיות.
const NEVER_FINANCIAL_SENDER_EXACT =
  /calendar-notification@google\.com|drive-shares[\w-]*@google\.com|comments-noreply@docs\.google\.com|meetings-noreply@google\.com/i;

// תבניות של התראות מערכת/פיתוח שאינן מסמכים פיננסיים. נבדקות על נושא+גוף.
const NON_INVOICE_NOTIFICATION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "github_activity", pattern: /pull\s+request|merge\s+request|\bissue\s*#\d|\bcommit\b|code\s+review|dependabot|force[- ]pushed|review\s+requested/i },
  { label: "ci_cd", pattern: /build\s+(?:failed|passed|succeeded)|deploy(?:ment)?\s+(?:failed|succeeded|live)|pipeline\s+(?:failed|passed)|workflow\s+run/i },
  { label: "account_security", pattern: /password\s+reset|reset\s+your\s+password|verify\s+your\s+email|security\s+alert|new\s+sign[\s-]?in|two[- ]factor|איפוס\s+סיסמה|התראת\s+אבטחה/i },
  { label: "calendar_meeting", pattern: /calendar\s+invitation|invited\s+you\s+to|zoom\s+meeting|google\s+meet|webinar|הזמנה\s+ליומן|זימון\s+לפגישה/i },
  { label: "social_notification", pattern: /mentioned\s+you|commented\s+on|liked\s+your|new\s+follower|friend\s+request/i },
];

// מילות מפתח פיננסיות חזקות — נוכחות בנושא/שם קובץ/גוף גוברת על כל חסימה.
// עברית דרך hebrewKeywordPattern: תומך בתחיליות ("הקבלה", "מהחשבונית",
// "בחיוב") אבל לא באמצע מילה ("התקבלה" לא נתפס כ"קבלה").
const STRONG_FINANCIAL_KEYWORDS = [
  /\binvoices?\b|\breceipts?\b|\btax\s+invoice\b|\bpayment\s+receipt\b|\bbilling\b|\bstatement\s+of\s+account\b|\bpayment\s+requests?\b|\bquotes?\b|\bpro\s*forma\b|\bpayslip\b|\bpayroll\b/i,
  hebrewKeywordPattern([
    "חשבוניות",
    "חשבונית",
    "קבלות",
    "קבלה",
    "חשבון\\s+עסקה",
    "דרישת\\s+תשלום",
    "דרישות\\s+תשלום",
    "אישור\\s+תשלום",
    "הצעת\\s+מחיר",
    "הצעות\\s+מחיר",
    "חיוב",
    "תלוש",
    "דיווח\\s+שכר",
    "משכורת",
  ]),
];

// אות של כסף: מטבע + ספרות, או ניסוח תשלום מפורש.
const MONEY_SIGNAL_PATTERNS = [
  /(?:₪|\$|€)\s*\d/,
  // בלי \b אחרי עברית — \b של JS הוא ASCII-בלבד ונכשל אחרי אות עברית
  /\d[\d,.]*\s*(?:₪|ש["״']?ח|שקלים)/,
  /\d[\d,.]*\s*(?:ils|nis|usd|eur)\b/i,
  hebrewKeywordPattern(["לתשלום", "שולם", "יתרה\\s+לתשלום", "סכום\\s+לתשלום"]),
  /\bamount\s+due\b|\bbalance\s+due\b|\btotal\s+due\b|\bpayment\s+of\b/i,
];

// קבצים שיכולים להיות מסמך פיננסי. zip/html וכד' — לא.
const DOCUMENT_ATTACHMENT_PATTERN = /\.(pdf|png|jpe?g|tiff?|webp|heic|docx?|xlsx?|csv)$/i;

function senderDomainNeverFinancial(sender: string): string | null {
  const normalized = sender.toLowerCase();
  if (NEVER_FINANCIAL_SENDER_EXACT.test(normalized)) return "google-workspace-notification";
  for (const domain of NEVER_FINANCIAL_SENDER_DOMAINS) {
    if (normalized.includes(`@${domain}`) || normalized.includes(`.${domain}`)) {
      return domain;
    }
  }
  return null;
}

export function isInvoiceCandidate(input: InvoiceCandidateInput): InvoiceCandidateResult {
  const sender = input.sender?.trim() ?? "";
  const subject = input.subject?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  const attachmentNames = (input.attachmentFilenames ?? []).filter(Boolean);
  const subjectAndFilenames = [subject, ...attachmentNames].join("\n");
  const combined = `${subject}\n${body}`;
  const reasons: string[] = [];

  const strongKeywordInHeader = STRONG_FINANCIAL_KEYWORDS.some((pattern) => pattern.test(subjectAndFilenames));
  const strongKeywordInBody = STRONG_FINANCIAL_KEYWORDS.some((pattern) => pattern.test(body));
  const hasDocumentAttachment = attachmentNames.some((name) => DOCUMENT_ATTACHMENT_PATTERN.test(name.trim()));
  const hasMoneySignal = MONEY_SIGNAL_PATTERNS.some((pattern) => pattern.test(combined));

  // חסימה 1: שולח מרשימת ה-never-financial. מילת מפתח פיננסית חזקה גוברת —
  // קבלה על מנוי GitHub נשלחת מ-github.com עם "payment receipt" בנושא.
  const blockedDomain = senderDomainNeverFinancial(sender);
  if (blockedDomain && !strongKeywordInHeader && !strongKeywordInBody) {
    return {
      isInvoice: false,
      confidence: 0.05,
      reasons: [`never_financial_sender:${blockedDomain}`],
    };
  }

  // חסימה 2: תבנית התראה מובהקת (PR, CI, אבטחה, יומן) בלי שום עוגן פיננסי.
  const notificationMatch = NON_INVOICE_NOTIFICATION_PATTERNS.find(({ pattern }) => pattern.test(combined));
  if (notificationMatch && !strongKeywordInHeader && !strongKeywordInBody && !hasDocumentAttachment) {
    return {
      isInvoice: false,
      confidence: 0.1,
      reasons: [`non_invoice_notification:${notificationMatch.label}`],
    };
  }

  // אותות חיוביים, מהחזק לחלש
  if (strongKeywordInHeader) {
    reasons.push("financial_keyword_in_subject_or_filename");
    return { isInvoice: true, confidence: 0.9, reasons };
  }
  if (strongKeywordInBody) {
    reasons.push("financial_keyword_in_body");
    return { isInvoice: true, confidence: 0.75, reasons };
  }
  if (hasDocumentAttachment && hasMoneySignal) {
    reasons.push("document_attachment_with_money_signal");
    return { isInvoice: true, confidence: 0.65, reasons };
  }
  if (hasDocumentAttachment) {
    // מקל בכוונה: חשבוניות רבות מגיעות כ-PDF עם גוף ריק ("מצורף"). תוכן
    // הקובץ עצמו ייבדק בהמשך הצינור — עדיף false positive מחסימת חשבונית.
    reasons.push("document_attachment_only");
    return { isInvoice: true, confidence: 0.55, reasons };
  }
  if (hasMoneySignal) {
    reasons.push("money_signal_without_document");
    return { isInvoice: true, confidence: 0.55, reasons };
  }

  reasons.push("no_financial_signal");
  if (notificationMatch) reasons.push(`non_invoice_notification:${notificationMatch.label}`);
  return { isInvoice: false, confidence: 0.2, reasons };
}
