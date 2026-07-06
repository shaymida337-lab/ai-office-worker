import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNatalieOwnerDailySummary,
  buildNatalieStaleLeadsBatch,
  buildNatalieTestMessage,
  buildNatalieMeetingReminder,
  buildNatalieErrorFallback,
  extractFirstName,
  formatSupplierDisplayName,
  NATALIE_BRAND,
  sanitizeWhatsAppText,
  validateNatalieWhatsAppBrand,
} from "./natalieWhatsAppUx.js";

test("sanitizeWhatsAppText removes forbidden branding and unknown labels", () => {
  const input = "Re: AI Office Worker alert — supplier Unknown from Anthropic PBC";
  const output = sanitizeWhatsAppText(input);
  assert.doesNotMatch(output, /AI Office Worker/i);
  assert.doesNotMatch(output, /Anthropic/i);
  assert.doesNotMatch(output, /\bUnknown\b/i);
  assert.match(output, /נטלי/);
  assert.match(output, /ספק לא מזוהה/);
});

test("formatSupplierDisplayName handles low-confidence and unknown suppliers", () => {
  assert.equal(formatSupplierDisplayName("Unknown"), "ספק לא מזוהה");
  assert.equal(formatSupplierDisplayName("Acme Ltd"), "Acme Ltd");
  assert.equal(formatSupplierDisplayName(null, { pendingIdentification: true }), "חשבונית ממתינה לזיהוי");
});

test("extractFirstName returns first token", () => {
  assert.equal(extractFirstName("שי מידה"), "שי");
  assert.equal(extractFirstName(""), "שם");
});

test("buildNatalieStaleLeadsBatch merges duplicate alerts", () => {
  assert.match(buildNatalieStaleLeadsBatch(8), /8 לידים/);
  assert.match(buildNatalieStaleLeadsBatch(1), /ליד אחד/);
});

test("buildNatalieOwnerDailySummary follows Natalie UX structure", () => {
  const message = buildNatalieOwnerDailySummary({
    firstName: "שי",
    weekday: "יום ראשון",
    dateLabel: "6 ביולי 2026",
    payments: { totalAmount: 1200, urgentCount: 2, upcomingCount: 3 },
    invoices: { pending: 4, needsReview: 1, newToday: 2 },
    leads: { newCount: 1, needsHandlingCount: 8 },
    todayMeetings: [{ time: "10:00", title: "פגישת ייעוץ" }],
    openTasks: 5,
    attentionItems: ["8 לידים לא טופלו מעל 48 שעות"],
  });

  assert.match(message, /🌅 בוקר טוב, שי!/);
  assert.match(message, new RegExp(`אני ${NATALIE_BRAND}`));
  assert.match(message, /💰 לתשלום/);
  assert.match(message, /📄 חשבוניות/);
  assert.match(message, /👥 לידים/);
  assert.match(message, /📅 פגישות היום/);
  assert.match(message, /✅ משימות פתוחות/);
  assert.match(message, /⚠️ דורש את תשומת הלב שלך/);
  assert.match(message, /מאחלת לך יום מוצלח/);
  assert.doesNotMatch(message, /AI Office Worker/i);
});

test("buildNatalieTestMessage uses Natalie branding", () => {
  const message = buildNatalieTestMessage();
  assert.match(message, new RegExp(NATALIE_BRAND));
  assert.doesNotMatch(message, /AI Office Worker/i);
});

test("validateNatalieWhatsAppBrand flags forbidden content", () => {
  assert.deepEqual(validateNatalieWhatsAppBrand("AI Office Worker"), ["AI Office Worker"]);
  assert.deepEqual(validateNatalieWhatsAppBrand("בוקר טוב שי"), []);
});

test("buildNatalieMeetingReminder and error fallback use Natalie tone", () => {
  const meeting = buildNatalieMeetingReminder({ firstName: "שי", time: "10:00", title: "ייעוץ" });
  assert.match(meeting, /נטלי/);
  assert.match(buildNatalieErrorFallback(), /מצטערת/);
});
