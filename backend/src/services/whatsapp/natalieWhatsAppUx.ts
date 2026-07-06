import { isUnknownPlaceholder } from "../supplier/supplierValidation.js";

export const NATALIE_BRAND = "נטלי";

const FORBIDDEN_PHRASES = [
  "AI Office Worker",
  "Anthropic PBC",
  "Anthropic",
  "Acquire Notifications",
  "OpenAI",
];

export function extractFirstName(fullName: string | null | undefined, fallback = "שם"): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

export function formatHebrewWeekday(date: Date, timeZone = "Asia/Jerusalem"): string {
  const weekday = new Intl.DateTimeFormat("he-IL", { timeZone, weekday: "long" }).format(date);
  return weekday;
}

export function formatHebrewDateLabel(date: Date, timeZone = "Asia/Jerusalem"): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
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

export function natalieGreetingBlock(firstName: string, weekday: string, dateLabel: string): string {
  return [
    `🌅 בוקר טוב, ${firstName}!`,
    `אני ${NATALIE_BRAND} 😊`,
    `הנה הסיכום היומי שלך ליום ${weekday}, ${dateLabel}.`,
  ].join("\n");
}

export function natalieClosingBlock(): string {
  return "מאחלת לך יום מוצלח! 🌷\nאני כאן אם תצטרך משהו.";
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

function formatShekel(amount: number): string {
  return `₪${Math.round(amount).toLocaleString("he-IL")}`;
}

function sectionLine(label: string, value: string): string {
  return `• ${label}: ${value}`;
}

export function buildNatalieOwnerDailySummary(data: NatalieDailySummaryData): string {
  const lines: string[] = [
    natalieGreetingBlock(data.firstName, data.weekday, data.dateLabel),
    "",
    "💰 לתשלום",
    sectionLine("סכום כולל", formatShekel(data.payments.totalAmount)),
    sectionLine("תשלומים דחופים", String(data.payments.urgentCount)),
    sectionLine("תשלומים קרובים", String(data.payments.upcomingCount)),
    "",
    "📄 חשבוניות",
    sectionLine("ממתינות", String(data.invoices.pending)),
    sectionLine("דורשות בדיקה", String(data.invoices.needsReview)),
    sectionLine("חדשות", String(data.invoices.newToday)),
    "",
    "👥 לידים",
    sectionLine("חדשים", String(data.leads.newCount)),
    sectionLine("דורשים טיפול", String(data.leads.needsHandlingCount)),
    "",
    "📅 פגישות היום",
  ];

  if (data.todayMeetings.length === 0) {
    lines.push("• אין פגישות מתוכננות");
  } else {
    for (const meeting of data.todayMeetings.slice(0, 5)) {
      lines.push(`• ${meeting.time} — ${meeting.title}`);
    }
    if (data.todayMeetings.length > 5) {
      lines.push(`• ועוד ${data.todayMeetings.length - 5} פגישות`);
    }
  }

  lines.push("", "✅ משימות פתוחות", sectionLine("סה״כ", String(data.openTasks)));

  if (data.attentionItems.length > 0) {
    lines.push("", "⚠️ דורש את תשומת הלב שלך");
    for (const item of data.attentionItems.slice(0, 5)) {
      lines.push(`• ${item}`);
    }
  }

  lines.push("", natalieClosingBlock());
  return sanitizeWhatsAppText(lines.join("\n"));
}

export function buildNatalieStaleLeadsBatch(count: number): string {
  if (count <= 0) return "";
  if (count === 1) {
    return sanitizeWhatsAppText("⚠️ יש ליד אחד שלא טופל מעל 48 שעות.\nרוצה שאציג אותו?");
  }
  return sanitizeWhatsAppText(`⚠️ יש ${count} לידים שלא טופלו מעל 48 שעות.\nרוצה שאציג אותם?`);
}

export function buildNatalieUrgentEmailAlert(): string {
  return sanitizeWhatsAppText("⚠️ הגיע מייל שדורש תשומת לב דחופה.\nרוצה שאסכם לך אותו?");
}

export function buildNatalieMonthlyReportIntro(): string {
  return sanitizeWhatsAppText(`📊 סיכום חודשי מ${NATALIE_BRAND}`);
}

export function buildNatalieTestMessage(): string {
  return sanitizeWhatsAppText(`✅ הכל תקין! זו הודעת בדיקה מ${NATALIE_BRAND}.\nחיבור הוואטסאפ עובד כמו שצריך.`);
}

export function buildNataliePaymentReminder(input: {
  clientName: string;
  amount: number;
  daysOverdue: number;
}): string {
  const name = extractFirstName(input.clientName, input.clientName);
  return sanitizeWhatsAppText(
    [
      `שלום ${name},`,
      `כאן ${NATALIE_BRAND}.`,
      `רציתי להזכיר שיש חשבונית פתוחה על סך ${formatShekel(input.amount)}.`,
      input.daysOverdue > 0 ? `עברו ${input.daysOverdue} ימים מאז מועד התשלום.` : "",
      "אשמח לעזור אם צריך פרטים נוספים.",
    ]
      .filter(Boolean)
      .join("\n")
  );
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
    lines.push(`📋 יש ${input.tasksToday} משימות פתוחות להיום.`);
  } else {
    lines.push("✨ אין משימות דחופות להיום.");
  }
  if (input.pendingInvoice && input.pendingInvoice > 0) {
    lines.push(`💳 חשבונית פתוחה: ${formatShekel(input.pendingInvoice)}`);
  }
  if (input.tip?.trim()) {
    lines.push("", `💡 ${sanitizeWhatsAppText(input.tip)}`);
  }
  lines.push("", natalieClosingBlock());
  return sanitizeWhatsAppText(lines.join("\n"));
}

export function buildNatalieCriticalAlert(input: { clientName: string; issue: string; action: string }): string {
  return sanitizeWhatsAppText(
    [
      "🚨 דורש תשומת לב",
      "",
      `לקוח: ${extractFirstName(input.clientName, input.clientName)}`,
      `מה קורה: ${sanitizeWhatsAppText(input.issue)}`,
      `מה מומלץ: ${sanitizeWhatsAppText(input.action)}`,
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
      `אני ${NATALIE_BRAND} 😊`,
      "",
      `💰 הכנסות השבוע: ${formatShekel(input.income)}`,
      `🆕 לקוחות חדשים: ${input.newClients}`,
      `✅ משימות שהושלמו: ${input.completedTasks}`,
      `⭐ לקוח מוביל: ${extractFirstName(input.topClient, input.topClient)}`,
      "",
      natalieClosingBlock(),
    ].join("\n")
  );
}

export function buildNatalieInvoiceFound(input: {
  clientName: string;
  amount: number;
  from: string;
}): string {
  return sanitizeWhatsAppText(
    [
      `🧾 חשבונית חדשה נקלטה`,
      "",
      `מאת: ${formatSupplierDisplayName(input.from)}`,
      `סכום: ${formatShekel(input.amount)}`,
      "שמרתי אותה בצורה מסודרת עבורך.",
    ].join("\n")
  );
}

export function buildNatalieUrgentClientAlert(input: { clientName: string; message: string }): string {
  return sanitizeWhatsAppText(
    [`⚠️ עדכון חשוב`, "", sanitizeWhatsAppText(input.message), "", natalieClosingBlock()].join("\n")
  );
}

export function buildNatalieMeetingReminder(input: {
  firstName: string;
  time: string;
  title: string;
}): string {
  const name = extractFirstName(input.firstName, input.firstName);
  return sanitizeWhatsAppText(
    [
      `היי ${name},`,
      `כאן ${NATALIE_BRAND} 😊`,
      `תזכורת: יש לך פגישה היום בשעה ${input.time} — ${sanitizeWhatsAppText(input.title)}.`,
      "מאחלת לך פגישה מוצלחת! 🌷",
    ].join("\n")
  );
}

export function buildNatalieLeadReminder(input: { leadName: string; when: string }): string {
  const name = extractFirstName(input.leadName, input.leadName);
  return sanitizeWhatsAppText(
    `📌 תזכורת: הגיע הזמן לחזור לליד ${name} (${input.when}).\nרוצה שאכין לך הודעה?`
  );
}

export function buildNatalieErrorFallback(): string {
  return sanitizeWhatsAppText(
    "מצטערת, משהו לא הסתדר כרגע 😔\nאני כאן איתך — נסה שוב בעוד רגע, או כתוב לי מה אתה צריך."
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
      "אפשר לשאול אותי:",
      "• סיכום — הסיכום היומי",
      "• מצב — מבט מהיר על העסק",
      "• תשלומים — מה ממתין לתשלום",
      "• חסרות — חשבוניות שחסרות",
    ].join("\n")
  );
}

export function buildNatalieUnknownCommand(): string {
  return sanitizeWhatsAppText(`לא הכרתי את הבקשה. כתוב "עזרה" ואראה מה אפשר לעשות 😊`);
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
  ];
  for (const check of checks) {
    if (check.pattern.test(text)) issues.push(check.label);
  }
  return issues;
}
