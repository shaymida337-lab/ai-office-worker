import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCustomerCopy,
  customerCopyContainsForbiddenTerms,
  greetingForHour,
  inferReviewPresentation,
  natalieDuplicateMessage,
  natalieReviewMessage,
  natalieScanMessage,
} from "./copy.js";

test("natalie copy: greeting uses first name", () => {
  const greeting = greetingForHour(new Date("2026-06-23T22:00:00+03:00"), "שי");
  assert.equal(greeting, "לילה טוב שי");
});

test("natalie copy: scan running is natural Hebrew", () => {
  const text = natalieScanMessage("checking_email");
  assert.match(text, /בודקת את המיילים/);
  assert.equal(customerCopyContainsForbiddenTerms(text), null);
});

test("natalie copy: stale scan is friendly Hebrew", () => {
  const text = natalieScanMessage("unfinished");
  assert.match(text, /לא הסתיימה/);
  assert.equal(customerCopyContainsForbiddenTerms(text), null);
});

test("natalie copy: duplicate message", () => {
  assert.match(natalieDuplicateMessage({ supplierName: "בזק" }), /בזק/);
  assert.match(natalieDuplicateMessage(), /כבר שמור/);
});

test("natalie copy: ambiguous supplier review", () => {
  const text = natalieReviewMessage("ambiguous_supplier");
  assert.match(text, /שני ספקים/);
  assert.equal(customerCopyContainsForbiddenTerms(text), null);
});

test("natalie copy: infer ambiguous supplier from reason", () => {
  assert.equal(
    inferReviewPresentation({ reviewStatus: "needs_review", uncertaintyReason: "two possible suppliers" }),
    "ambiguous_supplier"
  );
});

test("natalie copy: never expose forbidden engine terms", () => {
  const samples = [
    natalieScanMessage("checking_email"),
    natalieScanMessage("unfinished"),
    natalieDuplicateMessage({ supplierName: "אלקטרה" }),
    natalieReviewMessage("needs_confirmation", { supplierName: "ספק" }),
  ];
  for (const sample of samples) {
    assert.equal(customerCopyContainsForbiddenTerms(sample), null);
    assertCustomerCopy(sample);
  }
});

test("natalie copy: english uncertainty is sanitized", () => {
  const text = natalieReviewMessage("needs_confirmation", {
    supplierName: "בזק",
    uncertaintyReason: "low confidence supplier match",
  });
  assert.doesNotMatch(text, /confidence/i);
  assert.match(text, /לוודא/);
});
