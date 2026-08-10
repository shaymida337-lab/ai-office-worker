import assert from "node:assert/strict";
import test from "node:test";
import {
  assessInvoiceCompleteness,
  INVOICE_COMPLETION_REASON,
} from "./amount/invoiceCompleteness.js";
import {
  isConfidentlyNotFinancialDocument,
  resolveExtractedDocumentFinancial,
} from "./classification/financialDocumentClassification.js";
import {
  evaluateReviewApprovalReadiness,
  isInvoiceLikeDocumentType,
  isPaymentDocumentType,
  normalizeFinancialDocumentType,
  resolveFinancialDocumentApprovalTargetScreen,
} from "./financialDocuments.js";

/** Mirrors routes/api.ts INVOICE_LIKE_SUPPLIER_PAYMENT_TYPES — credit_note must stay out. */
const INVOICE_LIKE_SUPPLIER_PAYMENT_TYPES = ["tax_invoice", "receipt", "tax_invoice_receipt"] as const;

test("normalizeFinancialDocumentType keeps credit_note distinct from tax_invoice", () => {
  assert.equal(normalizeFinancialDocumentType("credit_note"), "credit_note");
  assert.equal(normalizeFinancialDocumentType("Credit Note"), "credit_note");
  assert.equal(normalizeFinancialDocumentType("חשבונית זיכוי"), "credit_note");
  assert.equal(normalizeFinancialDocumentType("הודעת זיכוי"), "credit_note");
  assert.notEqual(normalizeFinancialDocumentType("credit_note"), "tax_invoice");
  assert.notEqual(normalizeFinancialDocumentType("credit_note"), "irrelevant");
});

test("credit_note is financial payment type but not invoice-like / invoices list type", () => {
  const normalized = normalizeFinancialDocumentType("credit_note");
  assert.equal(isPaymentDocumentType(normalized), true);
  assert.equal(isInvoiceLikeDocumentType(normalized), false);
  assert.equal(
    (INVOICE_LIKE_SUPPLIER_PAYMENT_TYPES as readonly string[]).includes("credit_note"),
    false
  );
  assert.equal(resolveFinancialDocumentApprovalTargetScreen("credit_note"), "payments");
  assert.equal(resolveFinancialDocumentApprovalTargetScreen("tax_invoice"), "invoices");
});

test("credit_note is not confidently non-financial", () => {
  assert.equal(
    resolveExtractedDocumentFinancial({
      documentType: "credit_note",
      supplierName: "אפסילון לוגיסטיקה בע״מ",
      totalAmount: 120,
    }),
    true
  );
  assert.equal(
    isConfidentlyNotFinancialDocument({
      documentType: "credit_note",
      supplierName: "אפסילון לוגיסטיקה בע״מ",
      totalAmount: 120,
      pdfText: "חשבונית זיכוי",
    }),
    false
  );
});

test("credit_note with vendor+amount routes to invoices (type gap is approval-only)", () => {
  const assessment = assessInvoiceCompleteness({
    supplierName: "אפסילון לוגיסטיקה בע״מ",
    amount: 120,
    amountResolved: true,
    currency: "ILS",
    currencyExplicit: true,
    date: new Date("2026-06-08"),
    documentDateExplicit: true,
    documentType: "credit_note",
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
  });
  assert.equal(assessment.isComplete, true);
  assert.ok(assessment.approvalReasons.includes(INVOICE_COMPLETION_REASON.MISSING_DOCUMENT_TYPE));
  assert.equal(assessment.missingDataReasons.includes(INVOICE_COMPLETION_REASON.MISSING_DOCUMENT_TYPE), false);
});

test("credit_note cannot be approved as a regular tax invoice", async () => {
  const readiness = await evaluateReviewApprovalReadiness({
    organizationId: "org-credit-1",
    reviewStatus: "needs_review",
    source: "gmail",
    documentType: "credit_note",
    totalAmount: 120,
    amountBeforeVat: null,
    vatAmount: null,
    currency: "ILS",
    parsedFieldsJson: null,
    supplierName: "אפסילון לוגיסטיקה בע״מ",
    sender: null,
    supplierTaxId: null,
    invoiceNumber: "SYN-CN-001",
    documentDate: new Date("2026-06-08"),
    documentFingerprint: "fp-credit-1",
    uncertaintyReason: null,
  });
  assert.equal(readiness.canApprove, false);
  assert.ok(readiness.blockReason && /זיכוי/.test(readiness.blockReason));
  assert.equal(readiness.recommendedAction, "complete_details");
});
