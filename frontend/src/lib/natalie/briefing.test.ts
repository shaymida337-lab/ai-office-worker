import test from "node:test";
import assert from "node:assert/strict";
import { buildNatalieBriefing, buildQuietSummary } from "./briefing.js";
import { customerCopyContainsForbiddenTerms } from "./copy.js";

test("natalie briefing: builds greeting summary and primary action", () => {
  const briefing = buildNatalieBriefing({
    screen: "today",
    ownerFirstName: "שי",
    now: new Date("2026-06-23T08:00:00+03:00"),
    gmailConnected: true,
    invoicesSaved: 2,
    paymentsPrepared: 1,
    documentReviews: [
      {
        id: "r1",
        supplierName: "בזק",
        reviewStatus: "needs_review",
        uncertaintyReason: "two possible suppliers",
      },
    ],
    unpaidPayments: [],
    openTasksCount: 0,
  });

  assert.equal(briefing.greeting, "בוקר טוב שי");
  assert.match(briefing.summary, /נשאר/);
  assert.ok(briefing.completedItems.some((item) => item.text.includes("בדקתי")));
  assert.ok(briefing.pendingItems.some((item) => item.text.includes("ספק")));
  assert.match(briefing.primaryAction.label, /אשר/);
  assert.ok(briefing.suggestedQuestions.length >= 2);
});

test("natalie briefing: empty pending state", () => {
  const briefing = buildNatalieBriefing({
    screen: "today",
    gmailConnected: true,
    documentReviews: [],
    unpaidPayments: [],
    openTasksCount: 0,
  });

  assert.equal(briefing.pendingItems.length, 0);
  assert.match(briefing.summary, /אין כרגע/);
  assert.equal(briefing.primaryAction.label, "בוא נתחיל");
});

test("natalie briefing: customer copy stays clean", () => {
  const briefing = buildNatalieBriefing({
    screen: "today",
    ownerFirstName: "שי",
    gmailConnected: true,
    scanRunning: true,
    documentReviews: [{ id: "1", supplierName: "X", reviewStatus: "needs_review" }],
    unpaidPayments: [{ id: "p1", supplier: "Y", paid: false }],
    missingInvoices: [{ id: "m1", supplier: "Z", missingInvoice: true }],
    openTasksCount: 2,
  });

  const allText = [
    briefing.greeting,
    briefing.summary,
    ...briefing.completedItems.map((i) => i.text),
    ...briefing.pendingItems.map((i) => i.text),
    briefing.primaryAction.label,
    ...briefing.suggestedQuestions,
  ].join(" ");

  assert.equal(customerCopyContainsForbiddenTerms(allText), null);
});

test("natalie briefing: quiet summary chips", () => {
  const chips = buildQuietSummary({
    screen: "today",
    documentReviews: [{ id: "1" }],
    unpaidPayments: [{ id: "p1" }, { id: "p2" }],
    openTasksCount: 3,
    upcomingAppointments: [{ id: "a1", startTime: "2026-06-24T10:00:00.000Z" }],
  });

  assert.equal(chips.find((c) => c.id === "reviews")?.value, "1");
  assert.equal(chips.find((c) => c.id === "tasks")?.value, "3");
});

test("natalie briefing: pending scheduling decisions use Hebrew copy", () => {
  const briefing = buildNatalieBriefing({
    screen: "today",
    gmailConnected: true,
    documentReviews: [],
    unpaidPayments: [],
    openTasksCount: 0,
    pendingSchedulingDecisions: [
      {
        id: "dec-1",
        type: "confirm_appointment",
        typeLabel: "אישור תור",
        title: "תור לדנה",
        createdAt: "2026-06-21T10:00:00.000Z",
        href: "/dashboard/calendar?decisionId=dec-1",
      },
    ],
  });

  assert.ok(briefing.pendingItems.some((item) => item.text.includes("ממתין לאישורך")));
  assert.match(briefing.primaryAction.label, /החלטת יומן|אשר/);
});
