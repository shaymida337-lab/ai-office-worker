import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNatalieMonthlyReport,
  buildNatalieOwnerDailySummary,
  buildNatalieOwnerDailySummaryV1,
  buildNatalieStaleLeadsBatch,
  buildNatalieTestMessage,
  buildNatalieMeetingReminder,
  buildNatalieErrorFallback,
  buildNatalieCriticalAlert,
  buildNatalieInvoiceFound,
  extractFirstName,
  formatSupplierDisplayName,
  NATALIE_BRAND,
  pickNatalieClosing,
  sanitizeWhatsAppText,
  validateNatalieWhatsAppBrand,
} from "./natalieWhatsAppUx.js";

const sampleDaily = {
  firstName: "שי",
  weekday: "יום ראשון",
  dateLabel: "6 ביולי 2026",
  payments: { totalAmount: 18450, urgentCount: 3, upcomingCount: 5 },
  invoices: { pending: 7, needsReview: 2, newToday: 4 },
  leads: { newCount: 2, needsHandlingCount: 8 },
  todayMeetings: [
    { time: "09:30", title: "ייעוץ עסקי" },
    { time: "14:00", title: "סקירת תשלומים" },
  ],
  openTasks: 6,
  attentionItems: [],
};

test("sanitizeWhatsAppText removes forbidden branding and unknown labels", () => {
  const input = "Re: AI Office Worker alert — supplier Unknown from Anthropic PBC";
  const output = sanitizeWhatsAppText(input);
  assert.doesNotMatch(output, /AI Office Worker/i);
  assert.doesNotMatch(output, /\bUnknown\b/i);
});

test("formatSupplierDisplayName handles low-confidence and unknown suppliers", () => {
  assert.equal(formatSupplierDisplayName("Unknown supplier"), "ספק לא מזוהה");
  assert.equal(formatSupplierDisplayName("Acme Ltd"), "Acme Ltd");
});

test("buildNatalieOwnerDailySummary v2 is compact and proactive", () => {
  const message = buildNatalieOwnerDailySummary(sampleDaily);
  assert.match(message, /היום מחכים לך:/);
  assert.match(message, /💰 ₪18,450 · 3 דחופים/);
  assert.match(message, /8 לידים שממתינים לטיפול/);
  assert.match(message, /3 תשלומים שכדאי לסגור/);
  assert.doesNotMatch(message, /אני כאן אם תצטרך משהו/);
  assert.doesNotMatch(message, /סכום כולל/);
  assert.ok(message.length <= 450, `summary too long: ${message.length}`);
});

test("v2 quiet day is shorter than v1", () => {
  const quiet = {
    firstName: "שי",
    weekday: "יום ראשון",
    dateLabel: "6 ביולי 2026",
    payments: { totalAmount: 0, urgentCount: 0, upcomingCount: 0 },
    invoices: { pending: 0, needsReview: 0, newToday: 0 },
    leads: { newCount: 0, needsHandlingCount: 0 },
    todayMeetings: [],
    openTasks: 0,
    attentionItems: [],
  };
  const v1 = buildNatalieOwnerDailySummaryV1(quiet);
  const v2 = buildNatalieOwnerDailySummary(quiet);
  assert.ok(v2.length < v1.length);
  assert.ok(v2.length <= 300, `quiet summary too long: ${v2.length}`);
});

test("pickNatalieClosing rotates by seed", () => {
  assert.notEqual(pickNatalieClosing("שי:2026-07-06"), pickNatalieClosing("דנה:2026-07-06"));
});

test("buildNatalieStaleLeadsBatch is proactive", () => {
  assert.match(buildNatalieStaleLeadsBatch(8), /לפי סדר דחיפות/);
});

test("buildNatalieCriticalAlert uses natural language", () => {
  const message = buildNatalieCriticalAlert({
    ownerFirstName: "שי",
    clientName: "דנה כהן",
    issue: "עדיין מחכה לתשובה כבר יותר מ־24 שעות",
    action: "ליצור איתה קשר עוד הבוקר",
  });
  assert.match(message, /🚨 שי,/);
  assert.match(message, /שמתי לב שדנה/);
  assert.doesNotMatch(message, /לקוח:/);
  assert.doesNotMatch(message, /מה קורה:/);
});

test("buildNatalieInvoiceFound reflects workflow status", () => {
  const review = buildNatalieInvoiceFound({
    clientName: "",
    amount: 100,
    from: "Wolt",
    workflowStatus: "needs_review",
  });
  assert.match(review, /לרשימת המסמכים לבדיקה/);

  const approval = buildNatalieInvoiceFound({
    clientName: "",
    amount: 100,
    from: "Wolt",
    workflowStatus: "pending_approval",
  });
  assert.match(approval, /ממתינה לאישור/);
});

test("buildNatalieMonthlyReport is dedicated format", () => {
  const message = buildNatalieMonthlyReport({
    firstName: "שי",
    monthLabel: "יוני 2026",
    payments: { paidThisMonth: 12000, outstanding: 4500, urgentCount: 2 },
    documents: { processed: 18, pendingReview: 3 },
    leads: { newCount: 5, closedCount: 3, awaiting: 2 },
    incomeThisMonth: 28000,
    highlights: ["הכנסות: 28,000 ₪"],
    openIssues: ["2 תשלומים דחופים פתוחים"],
  });
  assert.match(message, /📊 סיכום חודש/);
  assert.match(message, /רוצה שאכין גם דוח לרואה החשבון/);
  assert.doesNotMatch(message, /היום מחכים לך/);
});

test("validateNatalieWhatsAppBrand flags forbidden content", () => {
  assert.deepEqual(validateNatalieWhatsAppBrand("בוקר טוב שי"), []);
});

test("buildNatalieTestMessage uses Natalie branding", () => {
  assert.match(buildNatalieTestMessage(), new RegExp(NATALIE_BRAND));
});

test("buildNatalieMeetingReminder and error fallback use Natalie tone", () => {
  assert.match(buildNatalieMeetingReminder({ firstName: "שי", time: "10:00", title: "ייעוץ" }), /תזכורת קטנה/);
  assert.match(buildNatalieErrorFallback(), /אני כאן/);
});
