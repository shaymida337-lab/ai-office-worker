import {
  buildNatalieCriticalAlert,
  buildNatalieErrorFallback,
  buildNatalieInvoiceFound,
  buildNatalieMeetingReminder,
  buildNatalieMonthlyReport,
  buildNatalieOwnerDailySummary,
  buildNatalieOwnerDailySummaryV1,
  buildNataliePaymentReminder,
  buildNatalieStaleLeadsBatch,
  buildNatalieTestMessage,
  buildNatalieUrgentEmailAlert,
  formatSupplierDisplayName,
  sanitizeWhatsAppText,
  validateNatalieWhatsAppBrand,
} from "../src/services/whatsapp/natalieWhatsAppUx.js";

type QaExample = {
  id: number;
  name: string;
  before: string;
  after: string;
  chars: number;
  emojis: number;
  readingTimeSec: number;
  brandIssues: string[];
  improvement: string;
};

function countEmojis(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

function readingTimeSec(chars: number): number {
  return Math.max(1, Math.ceil(chars / 14));
}

function compare(id: number, name: string, before: string, after: string, improvement: string): QaExample {
  const final = sanitizeWhatsAppText(after);
  return {
    id,
    name,
    before,
    after: final,
    chars: final.length,
    emojis: countEmojis(final),
    readingTimeSec: readingTimeSec(final.length),
    brandIssues: validateNatalieWhatsAppBrand(final),
    improvement,
  };
}

const productionLikeDate = {
  firstName: "שי",
  weekday: "יום ראשון",
  dateLabel: "6 ביולי 2026",
};

const emptyDay = {
  ...productionLikeDate,
  payments: { totalAmount: 0, urgentCount: 0, upcomingCount: 0 },
  invoices: { pending: 0, needsReview: 0, newToday: 0 },
  leads: { newCount: 0, needsHandlingCount: 0 },
  todayMeetings: [],
  openTasks: 0,
  attentionItems: [],
};

const busyDay = {
  ...productionLikeDate,
  payments: { totalAmount: 18450, urgentCount: 3, upcomingCount: 5 },
  invoices: { pending: 7, needsReview: 2, newToday: 4 },
  leads: { newCount: 2, needsHandlingCount: 8 },
  todayMeetings: [
    { time: "09:30", title: "ייעוץ עסקי — דנה כהן" },
    { time: "14:00", title: "סקירת תשלומים" },
  ],
  openTasks: 6,
  attentionItems: [],
};

const examples: QaExample[] = [
  compare(
    1,
    "Morning summary (no activity)",
    buildNatalieOwnerDailySummaryV1(emptyDay),
    buildNatalieOwnerDailySummary(emptyDay),
    "הסרת כותרות משנה ארוכות; שורה אחת לכל תחום; סיום קצר במקום שני משפטים קבועים."
  ),
  compare(
    2,
    "Morning summary (full activity)",
    buildNatalieOwnerDailySummaryV1({ ...busyDay, attentionItems: ["8 לידים לא טופלו מעל 48 שעות"] }),
    buildNatalieOwnerDailySummary(busyDay),
    "מספרים דחוסים במקום רשימות; התראות פרואקטיביות עם CTA; מקסימום 2 נקודות תשומת לב."
  ),
  compare(
    3,
    "Unhandled leads alert",
    "⚠️ יש 8 לידים שלא טופלו מעל 48 שעות.\nרוצה שאציג אותם?",
    buildNatalieStaleLeadsBatch(8),
    "ניסוח חיובי ('ממתינים לטיפול') + הצעת מיון לפי דחיפות."
  ),
  compare(
    4,
    "New invoice notification",
    "🧾 חשבונית חדשה נקלטה\n\nמאת: ספק לא מזוהה\nסכום: ₪1,240\nשמרתי אותה בצורה מסודרת עבורך.",
    buildNatalieInvoiceFound({
      clientName: "שי",
      amount: 1240,
      from: formatSupplierDisplayName("Unknown supplier"),
      workflowStatus: "needs_review",
    }),
    "משקף תהליך אמיתי ('לרשימת המסמכים לבדיקה') במקום משפט גנרי על שמירה."
  ),
  compare(
    5,
    "Payment reminder",
    "שלום דנה,\nכאן נטלי.\nרציתי להזכיר שיש חשבונית פתוחה על סך ₪890.\nעברו 5 ימים מאז מועד התשלום.\nאשמח לעזור אם צריך פרטים נוספים.",
    buildNataliePaymentReminder({ clientName: "דנה כהן", amount: 890, daysOverdue: 5 }),
    "טון אנושי יותר ('בנימוס') בלי חזרה על 'כאן נטלי'."
  ),
  compare(
    6,
    "Meeting reminder",
    "היי שי,\nכאן נטלי 😊\nתזכורת: יש לך פגישה היום בשעה 14:00 — ייעוץ עסקי — דנה כהן.\nמאחלת לך פגישה מוצלחת! 🌷",
    buildNatalieMeetingReminder({ firstName: "שי", time: "14:00", title: "ייעוץ עסקי — דנה כהן" }),
    "תזכורת קצרה בשורה אחת; פחות תבנית 'כאן נטלי'."
  ),
  compare(
    7,
    "Urgent business alert",
    "🚨 דורש תשומת לב\n\nלקוח: דנה\nמה קורה: לקוחה ממתינה לתשובה מעל 24 שעות\nמה מומלץ: להתקשר אליה היום לפני הצהריים",
    buildNatalieCriticalAlert({
      ownerFirstName: "שי",
      clientName: "דנה כהן",
      issue: "עדיין מחכה לתשובה כבר יותר מ־24 שעות",
      action: "ליצור איתה קשר עוד הבוקר",
    }),
    "ייעוץ אישי מנטלי במקום תוויות מערכת; פנייה ישירה לבעל העסק."
  ),
  compare(
    8,
    "Monthly report",
    `📊 סיכום חודשי מנטלי\n\n${buildNatalieOwnerDailySummaryV1(busyDay)}`,
    buildNatalieMonthlyReport({
      firstName: "שי",
      monthLabel: "יוני 2026",
      payments: { paidThisMonth: 42300, outstanding: 8500, urgentCount: 2 },
      documents: { processed: 24, pendingReview: 3 },
      leads: { newCount: 5, closedCount: 3, awaiting: 2 },
      incomeThisMonth: 52000,
      highlights: ["הכנסות: 52,000 ₪", "5 לידים חדשים נכנסו"],
      openIssues: ["2 תשלומים דחופים פתוחים"],
    }),
    "דוח חודשי ייעודי עם מגמות, המלצה ו-CTA לרואה חשבון — לא עותק של סיכום בוקר."
  ),
  compare(
    9,
    "Test message",
    "✅ הכל תקין! זו הודעת בדיקה מנטלי.\nחיבור הוואטסאפ עובד כמו שצריך.",
    buildNatalieTestMessage(),
    "קצר וישיר בלי ניסוח טכני של 'הודעת בדיקה'."
  ),
  compare(
    10,
    "Error/fallback message",
    "מצטערת, משהו לא הסתדר כרגע 😔\nאני כאן איתך — נסה שוב בעוד רגע, או כתוב לי מה אתה צריך.",
    buildNatalieErrorFallback(),
    "קצר יותר; פחות מילים טכניות."
  ),
  compare(
    11,
    "Urgent email alert",
    "⚠️ הגיע מייל שדורש תשומת לב דחופה.\nרוצה שאסכם לך אותו?",
    buildNatalieUrgentEmailAlert(),
    "ניסוח טבעי ('נראה דחוף') + פעולה מוצעת מיידית."
  ),
];

const allBrandIssues = examples.flatMap((item) => item.brandIssues.map((issue) => ({ example: item.name, issue })));

console.log(
  JSON.stringify(
    {
      version: "v2",
      examples,
      allBrandIssues,
      pass: allBrandIssues.length === 0,
      avgChars: Math.round(examples.reduce((sum, e) => sum + e.chars, 0) / examples.length),
    },
    null,
    2
  )
);
