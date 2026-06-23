import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalmBriefingClose, buildProactiveDoneItems, resolveNatalieRecommendation } from "./recommendation.js";
import { customerCopyContainsForbiddenTerms } from "./copy.js";

test("recommendation: urgent payment wins over generic review", () => {
  const rec = resolveNatalieRecommendation({
    gmailConnected: true,
    unpaidPayments: [{ id: "1", supplier: "ספק א", paid: false, date: new Date().toISOString() }],
    documentReviews: [{ id: "r1", supplierName: "ספק ב" }],
  });
  assert.equal(rec.kind, "urgent_payment");
  assert.match(rec.reason, /היום|מחר/);
});

test("recommendation: blocked review beats ordinary review", () => {
  const rec = resolveNatalieRecommendation({
    gmailConnected: true,
    documentReviews: [
      { id: "r1", supplierName: "ספק א", uncertaintyReason: "ambiguous supplier" },
      { id: "r2", supplierName: "ספק ב" },
    ],
  });
  assert.equal(rec.kind, "blocked_review");
});

test("recommendation: all clear is calm", () => {
  const rec = resolveNatalieRecommendation({ gmailConnected: true });
  assert.equal(rec.kind, "all_clear");
  assert.match(rec.reason, /אין|סיימתי/);
});

test("recommendation: proactive invoice copy suggests starting urgent", () => {
  const items = buildProactiveDoneItems({
    screen: "today",
    gmailConnected: false,
    invoicesSaved: 8,
    documentReviews: [{ id: "1" }, { id: "2" }],
  });
  const invoiceLine = items.find((item) => item.id === "invoices");
  assert.match(invoiceLine?.text ?? "", /אני ממליצה/);
});

test("recommendation: customer copy stays clean", () => {
  const rec = resolveNatalieRecommendation({
    gmailConnected: true,
    documentReviews: [{ id: "1", supplierName: "ספק" }],
    unpaidPayments: [{ id: "p1", supplier: "ספק", paid: false, date: new Date().toISOString() }],
  });
  assert.equal(customerCopyContainsForbiddenTerms(`${rec.title} ${rec.reason}`), null);
});
