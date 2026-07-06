import {
  buildNatalieCriticalAlert,
  buildNatalieErrorFallback,
  buildNatalieInvoiceFound,
  buildNatalieMeetingReminder,
  buildNatalieMonthlyReportIntro,
  buildNatalieOwnerDailySummary,
  buildNataliePaymentReminder,
  buildNatalieStaleLeadsBatch,
  buildNatalieTestMessage,
  buildNatalieUrgentEmailAlert,
  formatSupplierDisplayName,
  sanitizeWhatsAppText,
  validateNatalieWhatsAppBrand,
} from "../src/services/whatsapp/natalieWhatsAppUx.js";
import { ownerTemplates } from "../src/services/messageTemplates.js";

type QaExample = {
  id: number;
  name: string;
  raw: string;
  final: string;
  chars: number;
  emojis: number;
  readingTimeSec: number;
  brandIssues: string[];
};

function countEmojis(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

function readingTimeSec(chars: number): number {
  return Math.max(1, Math.ceil(chars / 14));
}

function finalize(raw: string): string {
  return sanitizeWhatsAppText(raw);
}

function example(id: number, name: string, raw: string): QaExample {
  const final = finalize(raw);
  return {
    id,
    name,
    raw,
    final,
    chars: final.length,
    emojis: countEmojis(final),
    readingTimeSec: readingTimeSec(final.length),
    brandIssues: validateNatalieWhatsAppBrand(final),
  };
}

const productionLikeDate = {
  firstName: "שי",
  weekday: "יום ראשון",
  dateLabel: "6 ביולי 2026",
};

const examples: QaExample[] = [
  example(
    1,
    "Morning summary (no activity)",
    buildNatalieOwnerDailySummary({
      ...productionLikeDate,
      payments: { totalAmount: 0, urgentCount: 0, upcomingCount: 0 },
      invoices: { pending: 0, needsReview: 0, newToday: 0 },
      leads: { newCount: 0, needsHandlingCount: 0 },
      todayMeetings: [],
      openTasks: 0,
      attentionItems: [],
    })
  ),
  example(
    2,
    "Morning summary (full activity)",
    buildNatalieOwnerDailySummary({
      ...productionLikeDate,
      payments: { totalAmount: 18450, urgentCount: 3, upcomingCount: 5 },
      invoices: { pending: 7, needsReview: 2, newToday: 4 },
      leads: { newCount: 2, needsHandlingCount: 8 },
      todayMeetings: [
        { time: "09:30", title: "ייעוץ עסקי — דנה כהן" },
        { time: "14:00", title: "סקירת תשלומים" },
      ],
      openTasks: 6,
      attentionItems: ["8 לידים לא טופלו מעל 48 שעות", "תשלום דחוף לספק חשמל"],
    })
  ),
  example(3, "Unhandled leads alert", buildNatalieStaleLeadsBatch(8)),
  example(
    4,
    "New invoice notification",
    buildNatalieInvoiceFound({
      clientName: "שי",
      amount: 1240,
      from: formatSupplierDisplayName("Unknown supplier"),
    })
  ),
  example(
    5,
    "Payment reminder",
    buildNataliePaymentReminder({ clientName: "דנה כהן", amount: 890, daysOverdue: 5 })
  ),
  example(
    6,
    "Meeting reminder",
    buildNatalieMeetingReminder({ firstName: "שי", time: "14:00", title: "ייעוץ עסקי — דנה כהן" })
  ),
  example(
    7,
    "Urgent business alert",
    ownerTemplates.criticalAlert({
      clientName: "דנה כהן",
      issue: "לקוחה ממתינה לתשובה מעל 24 שעות",
      action: "להתקשר אליה היום לפני הצהריים",
    })
  ),
  example(
    8,
    "Monthly report",
    `${buildNatalieMonthlyReportIntro()}\n\n${buildNatalieOwnerDailySummary({
      ...productionLikeDate,
      payments: { totalAmount: 42300, urgentCount: 1, upcomingCount: 4 },
      invoices: { pending: 3, needsReview: 1, newToday: 0 },
      leads: { newCount: 5, needsHandlingCount: 2 },
      todayMeetings: [],
      openTasks: 4,
      attentionItems: [],
    })}`
  ),
  example(9, "Test message", buildNatalieTestMessage()),
  example(10, "Error/fallback message", buildNatalieErrorFallback()),
  example(
    11,
    "Urgent email alert (scheduler)",
    buildNatalieUrgentEmailAlert()
  ),
];

const allBrandIssues = examples.flatMap((item) => item.brandIssues.map((issue) => ({ example: item.name, issue })));

console.log(JSON.stringify({ examples, allBrandIssues, pass: allBrandIssues.length === 0 }, null, 2));
