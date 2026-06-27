import test from "node:test";
import assert from "node:assert/strict";
import { ARC_VERSION } from "../amount/canonicalAmount.js";
import type { MoneyDecision } from "../amount/canonicalAmount.js";
import { computeCanonicalFingerprint } from "../dedup/sharedMatcher.js";
import { SIR_VERSION } from "../supplier/supplierTypes.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";
import { computeFinancialSanity } from "./financialSanity.js";
import {
  evaluateCreditNoteValidation,
  evaluateCurrencyMismatch,
  evaluateDocumentTypeCeiling,
  evaluateDuplicateSuspicion,
  evaluateFutureInvoiceDate,
  evaluateImpossibleAmount,
  evaluateInvoiceSequenceAnomaly,
  evaluateMissingInvoiceNumber,
  evaluateNegativeInvoiceValidation,
  evaluateOcrSuspiciousPatterns,
  evaluateSupplierHistoricalRange,
  evaluateVatArithmetic,
} from "./sanityRules.js";
import type { FinancialSanityInput, SupplierAmountHistory } from "./sanityTypes.js";

function supplierDecision(overrides: Partial<SupplierDecision> = {}): SupplierDecision {
  return {
    supplierName: "Acme Ltd",
    canonicalSupplier: "acme",
    normalizedName: "acme",
    vatNumber: "514888888",
    domains: ["acme.co.il"],
    emails: ["billing@acme.co.il"],
    phones: [],
    aliases: [],
    logo: null,
    confidence: 0.92,
    evidenceScore: 0.9,
    reason: "test",
    reasonCode: "AI_EXTRACTED",
    evidence: [],
    candidates: [],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: SIR_VERSION,
    isStrongEnoughForAutoSave: true,
    ...overrides,
  };
}

function moneyDecision(overrides: Partial<MoneyDecision> = {}): MoneyDecision {
  return {
    selectedAmount: 1180,
    amountBeforeVat: 1000,
    vatAmount: 180,
    currency: "ILS",
    confidence: 0.9,
    evidenceScore: 0.88,
    reason: "test",
    reasonCode: "INVOICE_TOTAL",
    candidates: [],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: ARC_VERSION,
    isStrongEnoughForAutoSave: true,
    ...overrides,
  };
}

function baseInput(overrides: Partial<FinancialSanityInput> = {}): FinancialSanityInput {
  const organizationId = "org-fse";
  const fingerprint = computeCanonicalFingerprint({
    organizationId,
    supplierName: "Acme Ltd",
    supplierTaxId: "514888888",
    invoiceNumber: "INV-1001",
    totalAmount: 1180,
    documentDate: "2026-05-15",
    documentType: "tax_invoice",
  });

  return {
    organizationId,
    supplierDecision: supplierDecision(),
    moneyDecision: moneyDecision(),
    fingerprint,
    invoiceNumber: "INV-1001",
    documentDate: "2026-05-15",
    currency: "ILS",
    invoiceData: {
      documentType: "tax_invoice",
      rawOcrText: "חשבונית מס Acme Ltd סה\"כ 1,180 ₪",
    },
    context: {
      referenceDate: "2026-06-01",
      expectedCurrency: "ILS",
      supplierHistory: {
        invoiceCount: 5,
        minAmount: 400,
        maxAmount: 2500,
        averageAmount: 1100,
        typicalCurrency: "ILS",
        lastInvoiceNumber: "INV-0995",
        recentInvoiceNumbers: ["INV-0990", "INV-0995"],
      },
    },
    ...overrides,
  };
}

function history(overrides: Partial<SupplierAmountHistory> = {}): SupplierAmountHistory {
  return {
    invoiceCount: 5,
    minAmount: 400,
    maxAmount: 2500,
    averageAmount: 1100,
    typicalCurrency: "ILS",
    lastInvoiceNumber: "INV-0995",
    recentInvoiceNumbers: ["INV-0990", "INV-0995"],
    ...overrides,
  };
}

test("computeFinancialSanity returns fse-v1 decision with all rule results", () => {
  const result = computeFinancialSanity(baseInput());
  assert.equal(result.version, "fse-v1");
  assert.equal(result.overallStatus, "valid");
  assert.equal(result.errors.length, 0);
  assert.equal(result.ruleResults.length, 12);
  assert.equal(result.passedRules.length, 12);
  assert.equal(result.failedRules.length, 0);
  assert.ok(result.trustScore >= 90);
  assert.ok(result.confidence > 0.8);
});

test("FSE vat_arithmetic fails when subtotal plus VAT does not equal total", () => {
  const result = evaluateVatArithmetic(
    baseInput({
      moneyDecision: moneyDecision({
        selectedAmount: 1180,
        amountBeforeVat: 1000,
        vatAmount: 100,
      }),
    })
  );

  assert.equal(result.ruleId, "vat_arithmetic");
  assert.equal(result.severity, "error");
  assert.match(result.message, /does not match the invoice total/);
});

test("FSE vat_arithmetic passes when arithmetic is within tolerance", () => {
  const result = evaluateVatArithmetic(baseInput());
  assert.equal(result.passed, true);
  assert.match(result.message, /within the allowed tolerance/);
});

test("FSE impossible_amount fails for amounts above business limit", () => {
  const result = evaluateImpossibleAmount(
    baseInput({
      moneyDecision: moneyDecision({ selectedAmount: 2_000_000 }),
    })
  );

  assert.equal(result.severity, "error");
  assert.match(result.message, /exceeds the maximum reasonable business document limit/);
});

test("FSE impossible_amount warns on zero payable invoice", () => {
  const result = evaluateImpossibleAmount(
    baseInput({
      moneyDecision: moneyDecision({ selectedAmount: 0, amountBeforeVat: 0, vatAmount: 0 }),
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /exactly zero/);
});

test("FSE supplier_historical_range warns when amount is far above historical max", () => {
  const result = evaluateSupplierHistoricalRange(
    baseInput({
      moneyDecision: moneyDecision({ selectedAmount: 12_000 }),
      context: { supplierHistory: history({ maxAmount: 2500 }) },
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /historical maximum/);
});

test("FSE supplier_historical_range passes with insufficient history", () => {
  const result = evaluateSupplierHistoricalRange(
    baseInput({
      context: { supplierHistory: history({ invoiceCount: 1 }) },
    })
  );

  assert.equal(result.passed, true);
  assert.match(result.message, /Not enough supplier history/);
});

test("FSE future_invoice_date fails when document date is in the future", () => {
  const result = evaluateFutureInvoiceDate(
    baseInput({
      documentDate: "2026-12-31",
      context: { referenceDate: "2026-06-01" },
    })
  );

  assert.equal(result.severity, "error");
  assert.match(result.message, /is in the future/);
});

test("FSE duplicate_suspicion fails on matching canonical fingerprint", () => {
  const input = baseInput();
  const fingerprint = input.fingerprint!.fingerprint!;
  const result = evaluateDuplicateSuspicion(
    baseInput({
      context: {
        duplicateFingerprints: [fingerprint],
      },
    })
  );

  assert.equal(result.severity, "error");
  assert.match(result.message, /matches an existing invoice/);
});

test("FSE duplicate_suspicion warns on weak fingerprint tier", () => {
  const input = baseInput();
  const weakFingerprint = {
    ...input.fingerprint!,
    tier: "weak" as const,
    isStrongEnoughForAutoSaveDedup: false,
  };

  const result = evaluateDuplicateSuspicion(
    baseInput({
      fingerprint: weakFingerprint,
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /weak/);
});

test("FSE missing_invoice_number fails for tax invoice without number", () => {
  const result = evaluateMissingInvoiceNumber(
    baseInput({
      invoiceNumber: null,
      invoiceData: { documentType: "tax_invoice" },
    })
  );

  assert.equal(result.severity, "error");
  assert.match(result.message, /requires an invoice number/);
});

test("FSE missing_invoice_number warns on very short invoice number", () => {
  const result = evaluateMissingInvoiceNumber(
    baseInput({
      invoiceNumber: "7",
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /unusually short/);
});

test("FSE currency_mismatch fails when resolved currency differs from expected", () => {
  const result = evaluateCurrencyMismatch(
    baseInput({
      moneyDecision: moneyDecision({ currency: "USD" }),
      context: { expectedCurrency: "ILS" },
    })
  );

  assert.equal(result.severity, "error");
  assert.match(result.message, /does not match the expected/);
});

test("FSE currency_mismatch warns when multiple candidate currencies appear", () => {
  const result = evaluateCurrencyMismatch(
    baseInput({
      moneyDecision: moneyDecision({
        candidates: [
          { value: 100, kind: "invoice_total", source: "claude_file", currency: "ILS", tier: 1, score: 1 },
          { value: 100, kind: "invoice_total", source: "regex_gmail", currency: "USD", tier: 1, score: 1 },
        ],
      }),
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /Multiple currencies appeared/);
});

test("FSE negative_invoice_validation fails for negative standard invoice", () => {
  const result = evaluateNegativeInvoiceValidation(
    baseInput({
      moneyDecision: moneyDecision({ selectedAmount: -500 }),
      invoiceData: { documentType: "tax_invoice" },
    })
  );

  assert.equal(result.severity, "error");
  assert.match(result.message, /negative total/);
});

test("FSE negative_invoice_validation warns for positive credit note", () => {
  const result = evaluateNegativeInvoiceValidation(
    baseInput({
      moneyDecision: moneyDecision({ selectedAmount: 500 }),
      invoiceData: { documentType: "credit_note" },
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /Credit document type/);
});

test("FSE credit_note_validation fails when credit subtotal is positive", () => {
  const result = evaluateCreditNoteValidation(
    baseInput({
      moneyDecision: moneyDecision({
        selectedAmount: -500,
        amountBeforeVat: 400,
        vatAmount: -100,
      }),
      invoiceData: {
        documentType: "credit_note",
        referencedInvoiceNumber: "INV-1000",
      },
    })
  );

  assert.equal(result.severity, "error");
  assert.match(result.message, /subtotal is positive/);
});

test("FSE credit_note_validation warns when original invoice is not referenced", () => {
  const result = evaluateCreditNoteValidation(
    baseInput({
      moneyDecision: moneyDecision({
        selectedAmount: -500,
        amountBeforeVat: -420,
        vatAmount: -80,
      }),
      invoiceData: { documentType: "credit_note" },
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /does not reference an original invoice number/);
});

test("FSE invoice_sequence_anomaly warns when invoice number goes backwards", () => {
  const result = evaluateInvoiceSequenceAnomaly(
    baseInput({
      invoiceNumber: "INV-0900",
      context: { supplierHistory: history({ lastInvoiceNumber: "INV-0995" }) },
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /lower than the supplier's last seen invoice number/);
});

test("FSE invoice_sequence_anomaly fails when invoice number repeats in recent history", () => {
  const result = evaluateInvoiceSequenceAnomaly(
    baseInput({
      invoiceNumber: "INV-0990",
      context: { supplierHistory: history({ recentInvoiceNumbers: ["INV-0990", "INV-0995"] }) },
    })
  );

  assert.equal(result.severity, "error");
  assert.match(result.message, /already appears/);
});

test("FSE ocr_suspicious_patterns warns on repeated OCR character runs", () => {
  const result = evaluateOcrSuspiciousPatterns(
    baseInput({
      invoiceData: {
        documentType: "tax_invoice",
        rawOcrText: "סה\"כ 11111111 ש\"ח חשבונית",
      },
      moneyDecision: moneyDecision({ selectedAmount: 11111111 }),
    })
  );

  assert.equal(result.severity, "warning");
  assert.match(result.message, /repeated character runs|repeated identical digits/);
});

test("computeFinancialSanity marks ambiguous upstream decisions as review even without rule errors", () => {
  const result = computeFinancialSanity(
    baseInput({
      moneyDecision: moneyDecision({ status: "ambiguous", confidence: 0.4, selectedAmount: null }),
    })
  );

  assert.equal(result.overallStatus, "review");
  assert.ok(result.recommendation.length > 0);
});

test("computeFinancialSanity aggregates failed rules and lowers trust score", () => {
  const result = computeFinancialSanity(
    baseInput({
      invoiceNumber: null,
      documentDate: "2027-01-01",
      moneyDecision: moneyDecision({
        selectedAmount: 2_500_000,
        amountBeforeVat: 2_000_000,
        vatAmount: 100,
      }),
      context: {
        referenceDate: "2026-06-01",
        duplicateFingerprints: [baseInput().fingerprint!.fingerprint!],
      },
    })
  );

  assert.equal(result.overallStatus, "error");
  assert.ok(result.failedRules.includes("vat_arithmetic"));
  assert.ok(result.failedRules.includes("impossible_amount"));
  assert.ok(result.failedRules.includes("future_invoice_date"));
  assert.ok(result.failedRules.includes("duplicate_suspicion"));
  assert.ok(result.failedRules.includes("missing_invoice_number"));
  assert.ok(result.trustScore < 50);
  assert.match(result.explanation, /blocking issue/);
});

test("FSE document_type_ceiling warns when receipt exceeds conservative ceiling", () => {
  const result = evaluateDocumentTypeCeiling(
    baseInput({
      invoiceData: { documentType: "receipt" },
      moneyDecision: moneyDecision({ selectedAmount: 30_000 }),
    })
  );

  assert.equal(result.ruleId, "document_type_ceiling");
  assert.equal(result.severity, "warning");
  assert.match(result.message, /exceeds the conservative receipt review ceiling/);
});
