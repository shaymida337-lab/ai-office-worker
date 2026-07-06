import { isUnknownPlaceholder } from "../supplier/supplierValidation.js";

export const NATALIE_BRAND = "נטלי";

const FORBIDDEN_PHRASES = [
  "AI Office Worker",
  "Anthropic PBC",
  "Anthropic",
  "Acquire Notifications",
  "OpenAI",
];

export const NATALIE_CLOSINGS = [
  "שיהיה יום מוצלח 🌷",
  "בהצלחה היום!",
  "רוצה שאטפל בזה?",
  "אפשר לסגור את זה עכשיו.",
  "אני ממשיכה לעקוב בשבילך.",
  "אם תרצה, אני כבר יכולה להכין את השלב הבא.",
] as const;

export type NatalieInvoiceWorkflowStatus = "needs_review" | "pending_approval" | "processing";

const INVOICE_WORKFLOW_LINES: Record<NatalieInvoiceWorkflowStatus, string> = {
  needs_review: "הוספתי אותה לרשימת המסמכים לבדיקה.",
  pending_approval: "בדקתי אותה והיא ממתינה לאישור שלך.",
  processing: "אני כבר מתחילה לעבד אותה.",
};

export function extractFirstName(fullName: string | null | undefined, fallback = "שם"): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

export function formatHebrewWeekday(date: Date, timeZone = "Asia/Jerusalem"): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone, weekday: "long" }).format(date);
}

export function formatHebrewDateLabel(date: Date, timeZone = "Asia/Jerusalem"): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatHebrewMonthLabel(date: Date, timeZone = "Asia/Jerusalem"): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone, month: "long", year: "numeric" }).format(date);
}

export function isUnknownLike(value: string | null | undefined): boolean {
  if (!value?.trim()) return true;
  return isUnknownPlaceholder(value.trim());
}

export function formatSupplierDisplayName(
  name: string | null | undefined,
  options: { lowConfidence?: boolean; pendingIdentification?: boolean } = {}
): string {
  if (options.pendingIdentification) return "חשבונית ממתינה לזיהוי";
  const raw = (name ?? "").trim();
  if (!raw || isUnknownLike(raw) || options.lowConfidence) {
    return "ספק לא מזוהה";
  }
  return sanitizeWhatsAppText(raw);
}

export function sanitizeWhatsAppText(text: string): string {
  let result = text;
  for (const phrase of FORBIDDEN_PHRASES) {
    result = result.replaceAll(phrase, NATALIE_BRAND);
  }
  result = result.replace(/\bUnknown supplier\b/gi, "ספק לא מזוהה");
  result = result.replace(/\bUnknown\b/gi, "ספק לא מזוהה");
  result = result.replace(/^Re:\s*/gim, "");
  result = result.replace(/\*+/g, "");
  result = result.replace(/_([^_]+)_/g, "$1");
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export function pickNatalieClosing(seed = ""): string {
  const key = seed.trim() || new Date().toISOString().slice(0, 10);
  const hash = [...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return NATALIE_CLOSINGS[Math.abs(hash) % NATALIE_CLOSINGS.length];
}

/** @deprecated Use pickNatalieClosing(seed) */
export function natalieClosingBlock(seed = ""): string {
  return pickNatalieClosing(seed);
}

export type NatalieDailySummaryData = {
  firstName: string;
  weekday: string;
  dateLabel: string;
  payments: {
    totalAmount: number;
    urgentCount: number;
    upcomingCount: number;
  };
  invoices: {
    pending: number;
    needsReview: number;
    newToday: number;
  };
  leads: {
    newCount: number;
    needsHandlingCount: number;
  };
  todayMeetings: Array<{ time: string; title: string }>;
  openTasks: number;
  attentionItems: string[];
};

export type NatalieMonthlyReportData = {
  firstName: string;
  monthLabel: string;
  payments: {
    paidThisMonth: number;
    outstanding: number;
    urgentCount: number;
  };
  documents: {
    processed: number;
    pendingReview: number;
  };
  leads: {
    newCount: number;
    closedCount: number;
    awaiting: number;
  };
  incomeThisMonth: number;
  highlights: string[];
  openIssues: string[];
};

function formatShekel(amount: number): string {
  return `₪${Math.round(amount).toLocaleString("he-IL")}`;
}

function compactPaymentsLine(data: NatalieDailySummaryData): string {
  if (data.payments.totalAmount <= 0 && data.payments.urgentCount === 0) {
    return "💰 אין תשלומים דחופים";
  }
  const amount = formatShekel(data.payments.totalAmount);
  return data.payments.urgentCount > 0
    ? `💰 ${amount} · ${data.payments.urgentCount} דחופים`
    : `💰 ${amount} לתשלום`;
}

function compactDocumentsLine(data: NatalieDailySummaryData): string {
  if (data.invoices.pending === 0 && data.invoices.needsReview === 0 && data.invoices.newToday === 0) {
    return "📄 הכל מעודכן";
  }
  const parts: string[] = [];
  if (data.invoices.pending > 0) parts.push(`${data.invoices.pending} ממתינות`);
  if (data.invoices.needsReview > 0) parts.push(`${data.invoices.needsReview} לבדיקה`);
  if (data.invoices.newToday > 0 && parts.length < 2) parts.push(`${data.invoices.newToday} חדשות`);
  return `📄 ${parts.join(" · ")}`;
}

function compactLeadsLine(data: NatalieDailySummaryData): string {
  if (data.leads.needsHandlingCount === 0 && data.leads.newCount === 0) {
    return "👥 אין לידים ממתינים";
  }
  const parts: string[] = [];
  if (data.leads.needsHandlingCount > 0) parts.push(`${data.leads.needsHandlingCount} ממתינים`);
  if (data.leads.newCount > 0) parts.push(`${data.leads.newCount} חדשים`);
  return `👥 ${parts.join(" · ")}`;
}

function compactMeetingsLine(data: NatalieDailySummaryData): string {
  const count = data.todayMeetings.length;
  if (count === 0) return "📅 אין פגישות";
  if (count === 1) {
    const m = data.todayMeetings[0];
    return `📅 פגישה אחת · ${m.time}`;
  }
  return `📅 ${count} פגישות`;
}

function compactTasksLine(data: NatalieDailySummaryData): string {
  return data.openTasks > 0 ? `✅ ${data.openTasks} משימות` : "✅ אין משימות פתוחות";
}

function buildProactiveAttention(data: NatalieDailySummaryData): string[] {
  const items: string[] = [];

  if (data.leads.needsHandlingCount > 0) {
    items.push(
      data.leads.needsHandlingCount === 1
        ? "יש ליד אחד שממתין לטיפול — רוצה שאציג אותו?"
        : `יש ${data.leads.needsHandlingCount} לידים שממתינים לטיפול — רוצה שאציג לפי דחיפות?`
    );
  }

  if (data.payments.urgentCount > 0 && items.length < 2) {
    items.push(
      data.payments.urgentCount === 1
        ? "יש תשלום דחוף שכדאי לסגור הבוקר — לפתוח?"
        : `יש ${data.payments.urgentCount} תשלומים שכדאי לסגור הבוקר — לפתוח?`
    );
  }

  for (const item of data.attentionItems) {
    if (items.length >= 2) break;
    const cleaned = sanitizeWhatsAppText(item);
    if (!cleaned) continue;
    const duplicate = items.some((existing) => existing.includes(cleaned.slice(0, 12)));
    if (!duplicate) items.push(cleaned);
  }

  return items.slice(0, 2);
}

export function buildNatalieOwnerDailySummary(data: NatalieDailySummaryData): string {
  const closingSeed = `${data.firstName}:${data.dateLabel}:daily`;
  const attention = buildProactiveAttention(data);

  const lines: string[] = [
    `🌅 בוקר טוב, ${data.firstName}!`,
    `אני ${NATALIE_BRAND} 😊`,
    "",
    "היום מחכים לך:",
    compactPaymentsLine(data),
    compactDocumentsLine(data),
    compactLeadsLine(data),
    compactMeetingsLine(data),
    compactTasksLine(data),
  ];

  if (attention.length > 0) {
    lines.push("", "⚠️ דורש תשומת לב");
    for (const item of attention) {
      lines.push(`• ${item}`);
    }
  }

  lines.push("", pickNatalieClosing(closingSeed));
  return sanitizeWhatsAppText(lines.join("\n"));
}

export function buildNatalieMonthlyReport(data: NatalieMonthlyReportData): string {
  const closingSeed = `${data.firstName}:${data.monthLabel}:monthly`;
  const highlights =
    data.highlights.length > 0
      ? data.highlights
      : data.incomeThisMonth > 0
        ? [`הכנסות החודש: ${formatShekel(data.incomeThisMonth)}`]
        : ["החודש עבר בקצב יציב"];

  const openIssues =
    data.openIssues.length > 0
      ? data.openIssues
      : data.payments.urgentCount > 0
        ? [`${data.payments.urgentCount} תשלומים דחופים פתוחים`]
        : [];

  let recommendation = "להמשיך באותו קצב — העסק במסלול טוב.";
  if (data.payments.urgentCount > 0) {
    recommendation = "לסגור את התשלומים הדחופים עוד השבוע.";
  } else if (data.leads.awaiting > 0) {
    recommendation = "להקדיש זמן ללידים שממתינים — שם כנראה ההזדמנות הבאה.";
  } else if (data.documents.pendingReview > 0) {
    recommendation = "לנקות את המסמכים שממתינים לבדיקה לפני סוף החודש.";
  }

  const lines: string[] = [
    `📊 סיכום חודש — ${data.monthLabel}`,
    `${data.firstName}, הנה התמונה החודשית:`,
    "",
    `💰 ${formatShekel(data.payments.paidThisMonth)} שולמו · ${formatShekel(data.payments.outstanding)} פתוחים${
      data.payments.urgentCount > 0 ? ` · ${data.payments.urgentCount} דחופים` : ""
    }`,
    `📄 ${data.documents.processed} עובדו · ${data.documents.pendingReview} לבדיקה`,
    `👥 ${data.leads.newCount} חדשים · ${data.leads.closedCount} נסגרו · ${data.leads.awaiting} ממתינים`,
    "",
    "📈 בולט החודש:",
    ...highlights.slice(0, 2).map((h) => `• ${h}`),
  ];

  if (openIssues.length > 0) {
    lines.push("", "⚠️ פתוח:");
    for (const issue of openIssues.slice(0, 2)) {
      lines.push(`• ${issue}`);
    }
  }

  lines.push("", `המלצה שלי: ${recommendation}`);
  lines.push("", "רוצה שאכין גם דוח לרואה החשבון?");
  lines.push("", pickNatalieClosing(closingSeed));
  return sanitizeWhatsAppText(lines.join("\n"));
}

export function buildNatalieStaleLeadsBatch(count: number): string {
  if (count <= 0) return "";
  if (count === 1) {
    return sanitizeWhatsAppText("יש ליד אחד שממתין לטיפול.\nרוצה שאציג אותו לפי סדר דחיפות?");
  }
  return sanitizeWhatsAppText(
    `יש ${count} לידים שממתינים לטיפול.\nרוצה שאציג אותם לפי סדר דחיפות?`
  );
}

export function buildNatalieUrgentEmailAlert(): string {
  return sanitizeWhatsAppText("הגיע מייל שנראה דחוף.\nרוצה שאסכם לך אותו עכשיו?");
}

export function buildNatalieMonthlyReportIntro(): string {
  return sanitizeWhatsAppText(`📊 סיכום חודשי מ${NATALIE_BRAND}`);
}

export function buildNatalieTestMessage(): string {
  return sanitizeWhatsAppText(`✅ הכל תקין מצד הוואטסאפ — ${NATALIE_BRAND} כאן ומוכנה.`);
}

export function buildNataliePaymentReminder(input: {
  clientName: string;
  amount: number;
  daysOverdue: number;
}): string {
  const name = extractFirstName(input.clientName, input.clientName);
  const lines = [`היי ${name},`];
  lines.push(`רציתי להזכיר בנימוס על חשבונית של ${formatShekel(input.amount)} שעדיין פתוחה.`);
  if (input.daysOverdue > 0) {
    lines.push(`עברו ${input.daysOverdue} ימים מאז מועד התשלום.`);
  }
  lines.push("אשמח לעזור אם צריך פרטים או קישור לתשלום.");
  return sanitizeWhatsAppText(lines.join("\n"));
}

export function buildNatalieClientMorningBrief(input: {
  clientName: string;
  tasksToday: number;
  pendingInvoice?: number;
  tip?: string;
}): string {
  const name = extractFirstName(input.clientName, input.clientName);
  const lines = [`🌅 בוקר טוב, ${name}!`, `כאן ${NATALIE_BRAND} 😊`, ""];
  if (input.tasksToday > 0) {
    lines.push(`📋 ${input.tasksToday} משימות פתוחות להיום.`);
  } else {
    lines.push("✨ יום נקי ממשימות דחופות.");
  }
  if (input.pendingInvoice && input.pendingInvoice > 0) {
    lines.push(`💳 חשבונית פתוחה: ${formatShekel(input.pendingInvoice)}`);
  }
  if (input.tip?.trim()) {
    lines.push(`💡 ${sanitizeWhatsAppText(input.tip)}`);
  }
  lines.push("", pickNatalieClosing(`${name}:client-brief`));
  return sanitizeWhatsAppText(lines.join("\n"));
}

export function buildNatalieCriticalAlert(input: {
  ownerFirstName?: string;
  clientName: string;
  issue: string;
  action: string;
}): string {
  const owner = extractFirstName(input.ownerFirstName, "שם");
  const client = extractFirstName(input.clientName, input.clientName);
  const issue = sanitizeWhatsAppText(input.issue);
  const action = sanitizeWhatsAppText(input.action);

  return sanitizeWhatsAppText(
    [
      `🚨 ${owner},`,
      `שמתי לב ש${client} ${issue}.`,
      `אני ממליצה ${action}.`,
      "רוצה שאפתח את הפרטים?",
    ].join("\n")
  );
}

export function buildNatalieWeeklyReport(input: {
  week: string;
  income: number;
  newClients: number;
  completedTasks: number;
  topClient: string;
}): string {
  return sanitizeWhatsAppText(
    [
      `📊 סיכום שבועי — ${input.week}`,
      "",
      `💰 הכנסות: ${formatShekel(input.income)}`,
      `🆕 לקוחות חדשים: ${input.newClients}`,
      `✅ משימות שהושלמו: ${input.completedTasks}`,
      `⭐ לקוח מוביל: ${extractFirstName(input.topClient, input.topClient)}`,
      "",
      pickNatalieClosing(`weekly:${input.week}`),
    ].join("\n")
  );
}

export function buildNatalieInvoiceFound(input: {
  clientName: string;
  amount: number;
  from: string;
  workflowStatus?: NatalieInvoiceWorkflowStatus;
}): string {
  const status = input.workflowStatus ?? "needs_review";
  return sanitizeWhatsAppText(
    [
      `🧾 חשבונית חדשה מ${formatSupplierDisplayName(input.from)}`,
      `סכום: ${formatShekel(input.amount)}`,
      INVOICE_WORKFLOW_LINES[status],
      status === "pending_approval" ? "רוצה לאשר אותה עכשיו?" : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

export function buildNatalieUrgentClientAlert(input: { clientName: string; message: string }): string {
  const name = extractFirstName(input.clientName, input.clientName);
  return sanitizeWhatsAppText(
    [`${name}, עדכון חשוב:`, sanitizeWhatsAppText(input.message), pickNatalieClosing(`${name}:urgent`)].join("\n")
  );
}

export function buildNatalieMeetingReminder(input: {
  firstName: string;
  time: string;
  title: string;
}): string {
  const name = extractFirstName(input.firstName, input.firstName);
  const title = sanitizeWhatsAppText(input.title);
  return sanitizeWhatsAppText(
    `${name}, תזכורת קטנה — בשעה ${input.time} יש לך ${title}.\nבהצלחה בפגישה! 🌷`
  );
}

export function buildNatalieLeadReminder(input: { leadName: string; when: string }): string {
  const name = extractFirstName(input.leadName, input.leadName);
  return sanitizeWhatsAppText(
    `📌 הגיע הזמן לחזור ל${name} (${input.when}).\nרוצה שאכין לך הודעה מוכנה?`
  );
}

export function buildNatalieErrorFallback(): string {
  return sanitizeWhatsAppText(
    "אופס, משהו נתקע לרגע 😔\nנסה שוב בעוד רגע — אני כאן."
  );
}

export function buildNatalieUnmappedSenderMessage(): string {
  return sanitizeWhatsAppText(
    `היי! כאן ${NATALIE_BRAND} 😊\nעדיין לא זיהיתי את המספר הזה בעסק.\nחבר את הוואטסאפ בהגדרות ונסה שוב.`
  );
}

export function buildNatalieMediaDownloadFailedMessage(): string {
  return sanitizeWhatsAppText(
    "קיבלתי את הקובץ, אבל משהו לא הסתדר בשמירה 😔\nשלח שוב בעוד רגע ואטפל בזה."
  );
}

export function buildNatalieCommandHelp(): string {
  return sanitizeWhatsAppText(
    [
      `היי! אני ${NATALIE_BRAND} 😊`,
      "כתוב לי:",
      "• סיכום",
      "• מצב",
      "• תשלומים",
      "• חסרות",
    ].join("\n")
  );
}

export function buildNatalieUnknownCommand(): string {
  return sanitizeWhatsAppText(`לא הבנתי את הבקשה — כתוב "עזרה" ואכוון אותך 😊`);
}

export function validateNatalieWhatsAppBrand(text: string): string[] {
  const issues: string[] = [];
  const checks: Array<{ label: string; pattern: RegExp }> = [
    { label: "AI Office Worker", pattern: /AI Office Worker/i },
    { label: "Unknown", pattern: /\bUnknown\b/i },
    { label: "Re: prefix", pattern: /^Re:/im },
    { label: "null", pattern: /\bnull\b/i },
    { label: "undefined", pattern: /\bundefined\b/i },
    { label: "JSON fragment", pattern: /\{"/ },
    { label: "stack trace", pattern: /at\s+\S+\s+\(/ },
    { label: "system labels", pattern: /^(לקוח|מה קורה|מה מומלץ):/m },
  ];
  for (const check of checks) {
    if (check.pattern.test(text)) issues.push(check.label);
  }
  return issues;
}

/** v1 verbose summary — kept for QA before/after comparison only */
export function buildNatalieOwnerDailySummaryV1(data: NatalieDailySummaryData): string {
  const sectionLine = (label: string, value: string) => `• ${label}: ${value}`;
  const lines: string[] = [
    `🌅 בוקר טוב, ${data.firstName}!`,
    `אני ${NATALIE_BRAND} 😊`,
    `הנה הסיכום היומי שלך ליום ${data.weekday}, ${data.dateLabel}.`,
    "",
    "💰 לתשלום",
    sectionLine("סכום כולל", formatShekel(data.payments.totalAmount)),
    sectionLine("תשלומים דחופים", String(data.payments.urgentCount)),
    "",
    "📄 חשבוניות",
    sectionLine("ממתינות", String(data.invoices.pending)),
    "",
    "👥 לידים",
    sectionLine("דורשים טיפול", String(data.leads.needsHandlingCount)),
    "",
    "📅 פגישות היום",
    data.todayMeetings.length ? `• ${data.todayMeetings.length} פגישות` : "• אין פגישות",
    "",
    "✅ משימות פתוחות",
    sectionLine("סה״כ", String(data.openTasks)),
    "",
    "מאחלת לך יום מוצלח! 🌷",
    "אני כאן אם תצטרך משהו.",
  ];
  return sanitizeWhatsAppText(lines.join("\n"));
}
