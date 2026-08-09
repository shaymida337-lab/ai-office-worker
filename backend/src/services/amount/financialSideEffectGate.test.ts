/**
 * תיקון #3 — טסטים לשער תופעות-הלוואי הפיננסי המשותף. מוודאים את הכלל האחיד:
 * SupplierPayment / כתיבה ל-Sheets רק כאשר dataComplete + סטטוס מאושר +
 * (במסלול אוטומטי) confidence>=0.8, ושאישור אנושי גובר על סף הביטחון.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFinancialSideEffectGate, type FinancialSideEffectGateInput } from "./invoiceCompleteness.js";

const today = new Date().toISOString().slice(0, 10);

function completeAutoSaved(overrides: Partial<FinancialSideEffectGateInput> = {}): FinancialSideEffectGateInput {
  return {
    supplierName: "אלקטרה מיזוג אוויר בעמ",
    amount: 1170,
    amountResolved: true,
    currency: "ILS",
    currencyExplicit: true,
    date: today,
    documentDateExplicit: true,
    documentType: "invoice",
    reviewStatus: "auto_saved",
    rawReviewStatus: "auto_saved",
    confidenceScore: 0.9,
    numericConfidence: 0.9,
    ...overrides,
  };
}

test("שער חוסם כשהנתונים לא שלמים (חסר ספק)", () => {
  const decision = evaluateFinancialSideEffectGate(completeAutoSaved({ supplierName: null }));
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /data_incomplete/);
});

test("שער חוסם מסלול auto_saved עם confidence מתחת ל-0.8", () => {
  const decision = evaluateFinancialSideEffectGate(completeAutoSaved({ confidenceScore: 0.6, numericConfidence: 0.6 }));
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /confidence_below_threshold/);
});

test("שער מאשר auto_saved שלם עם confidence>=0.8", () => {
  const decision = evaluateFinancialSideEffectGate(completeAutoSaved());
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);
});

test("אישור אנושי (approved) גובר על סף הביטחון גם עם confidence נמוך", () => {
  const decision = evaluateFinancialSideEffectGate(
    completeAutoSaved({ reviewStatus: "approved", rawReviewStatus: "approved", confidenceScore: 0.3, numericConfidence: 0.3 }),
  );
  assert.equal(decision.allowed, true);
});

test("אישור אנושי לא גובר כשעדיין חסרים שדות חובה", () => {
  const decision = evaluateFinancialSideEffectGate(
    completeAutoSaved({ reviewStatus: "approved", rawReviewStatus: "approved", amount: 0, amountResolved: false }),
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /data_incomplete/);
});

test("שער חוסם סטטוס needs_review", () => {
  const decision = evaluateFinancialSideEffectGate(
    completeAutoSaved({ reviewStatus: "needs_review", rawReviewStatus: "needs_review" }),
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /status_not_approved/);
});

test("שער חוסם כשסוג המסמך אינו מוכר (לא חשבונית/קבלה)", () => {
  const decision = evaluateFinancialSideEffectGate(completeAutoSaved({ documentType: "other" }));
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /data_incomplete/);
});
