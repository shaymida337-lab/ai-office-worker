import test from "node:test";
import assert from "node:assert/strict";
import { ARC_VERSION } from "../amount/canonicalAmount.js";
import type { MoneyDecision } from "../amount/canonicalAmount.js";
import { computeCanonicalFingerprint, SCFC_VERSION } from "../dedup/sharedMatcher.js";
import type { CanonicalFingerprintResult } from "../dedup/sharedMatcher.js";
import { SIR_VERSION } from "../supplier/supplierTypes.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";
import { computeFinancialSanity } from "../validation/financialSanity.js";
import type { FinancialSanityDecision, FinancialSanityInput } from "../validation/sanityTypes.js";
import { FSE_VERSION } from "../validation/sanityTypes.js";
import { computeTrustDecision } from "./trustEngine.js";
import {
  detectStrongAgreement,
  evaluateArcContributor,
  evaluateFseContributor,
  evaluateTrustRules,
  weightedConfidence,
} from "./trustRules.js";
import type { TrustEngineInput } from "./trustTypes.js";
import { TE_VERSION } from "./trustTypes.js";

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

function strongFingerprint(): CanonicalFingerprintResult {
  return computeCanonicalFingerprint({
    organizationId: "org-te",
    supplierName: "Acme Ltd",
    supplierTaxId: "514888888",
    invoiceNumber: "INV-1001",
    totalAmount: 1180,
    documentDate: "2026-05-15",
    documentType: "tax_invoice",
  });
}

function fseInput(overrides: Partial<FinancialSanityInput> = {}): FinancialSanityInput {
  const organizationId = "org-te";
  const fingerprint = strongFingerprint();
  return {
    organizationId,
    supplierDecision: supplierDecision(),
    moneyDecision: moneyDecision(),
    fingerprint,
    invoiceNumber: "INV-1001",
    documentDate: "2026-05-15",
    dueDate: null,
    currency: "ILS",
    invoiceData: {
      documentType: "tax_invoice",
      rawOcrText: "חשבונית מס Acme Ltd",
      extractionSource: "test",
    },
    context: {
      referenceDate: "2026-06-01",
      expectedCurrency: "ILS",
    },
    ...overrides,
  };
}

function trustInput(overrides: Partial<TrustEngineInput> = {}): TrustEngineInput {
  return {
    fingerprint: strongFingerprint(),
    moneyDecision: moneyDecision(),
    supplierDecision: supplierDecision(),
    fseDecision: computeFinancialSanity(fseInput()),
    ...overrides,
  };
}

test("TE: returns te-v1 decision with contributors", () => {
  const decision = computeTrustDecision(trustInput());

  assert.equal(decision.version, TE_VERSION);
  assert.ok(decision.confidence >= 0 && decision.confidence <= 100);
  assert.ok(["AUTO_SAVE", "NEEDS_REVIEW", "BLOCK"].includes(decision.decision));
  assert.ok(decision.reason.length > 0);
  assert.ok(decision.reasonCode.length > 0);
  assert.ok(decision.explanation.length > 0);
  assert.ok(decision.contributors.some((item) => item.engine === "arc"));
  assert.ok(decision.contributors.some((item) => item.engine === "sir"));
  assert.ok(decision.contributors.some((item) => item.engine === "fse"));
  assert.ok(decision.contributors.some((item) => item.engine === "scfc"));
});

test("TE: perfect agreement yields AUTO_SAVE with strong agreement reason", () => {
  const decision = computeTrustDecision(trustInput());

  assert.equal(decision.decision, "AUTO_SAVE");
  assert.ok(decision.confidence >= 75);
  assert.ok(decision.reasonCode === "TE_STRONG_AGREEMENT" || decision.reasonCode === "TE_AUTO_SAVE");
  assert.equal(detectStrongAgreement(trustInput()), true);
});

test("TE: ARC weak routes to NEEDS_REVIEW", () => {
  const decision = computeTrustDecision(
    trustInput({
      moneyDecision: moneyDecision({
        status: "ambiguous",
        confidence: 0.42,
        isStrongEnoughForAutoSave: false,
        reasonCode: "AMBIGUOUS",
      }),
    })
  );

  assert.equal(decision.decision, "NEEDS_REVIEW");
  assert.equal(decision.reasonCode, "TE_UPSTREAM_REVIEW");
});

test("TE: SIR weak routes to NEEDS_REVIEW", () => {
  const decision = computeTrustDecision(
    trustInput({
      supplierDecision: supplierDecision({
        status: "missing",
        confidence: 0.2,
        isStrongEnoughForAutoSave: false,
        reasonCode: "MISSING",
      }),
    })
  );

  assert.equal(decision.decision, "NEEDS_REVIEW");
  assert.equal(decision.reasonCode, "TE_UPSTREAM_REVIEW");
});

test("TE: FSE error blocks automatic action", () => {
  const fseDecision = computeFinancialSanity(
    fseInput({
      documentDate: "2027-01-01",
    })
  );

  assert.equal(fseDecision.overallStatus, "error");
  const decision = computeTrustDecision(trustInput({ fseDecision }));

  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.reasonCode, "TE_FSE_CRITICAL_ERROR");
});

test("TE: FSE review propagates to NEEDS_REVIEW", () => {
  const fseDecision: FinancialSanityDecision = {
    ...computeFinancialSanity(fseInput()),
    overallStatus: "review",
    version: FSE_VERSION,
  };

  const decision = computeTrustDecision(trustInput({ fseDecision }));

  assert.equal(decision.decision, "NEEDS_REVIEW");
  assert.equal(decision.reasonCode, "TE_UPSTREAM_REVIEW");
});

test("TE: contributor scoring includes weighted engines", () => {
  const evaluation = evaluateTrustRules(trustInput());
  const arc = evaluation.contributors.find((item) => item.engine === "arc");
  const sir = evaluation.contributors.find((item) => item.engine === "sir");

  assert.ok(arc);
  assert.ok(sir);
  assert.equal(arc!.weight, 0.25);
  assert.equal(sir!.weight, 0.25);
  assert.ok(arc!.score > 0);
  assert.ok(typeof arc!.impact === "number");
});

test("TE: deterministic output for identical input", () => {
  const input = trustInput();
  const first = computeTrustDecision(input);
  const second = computeTrustDecision(input);

  assert.deepEqual(first, second);
});

test("TE: optional history influence reduces confidence", () => {
  const baseline = computeTrustDecision(trustInput());
  const withCorrections = computeTrustDecision(
    trustInput({
      context: {
        historicalCorrections: 4,
        userCorrectionRate: 0.4,
        supplierHistory: { invoiceCount: 2, correctionsCount: 4 },
      },
    })
  );

  assert.ok(withCorrections.confidence <= baseline.confidence);
  assert.ok(
    withCorrections.contributors.some((item) => item.explanation.includes("Optional learning"))
  );
});

test("TE: supplier history can increase confidence when no corrections", () => {
  const baseline = computeTrustDecision(
    trustInput({
      context: {
        ocrQuality: 0.95,
        attachmentQuality: 0.95,
      },
    })
  );
  const withHistory = computeTrustDecision(
    trustInput({
      context: {
        ocrQuality: 0.95,
        attachmentQuality: 0.95,
        supplierHistory: { invoiceCount: 12, correctionsCount: 0 },
      },
    })
  );

  assert.ok(withHistory.confidence >= baseline.confidence);
});

test("TE: confidence boundaries stay within 0-100", () => {
  const weak = computeTrustDecision(
    trustInput({
      fingerprint: {
        fingerprint: null,
        tier: "none",
        version: SCFC_VERSION,
        isStrongEnoughForAutoSaveDedup: false,
        legacyFingerprint: "legacy",
        normalizedInputs: {
          supplier: "",
          taxId: "",
          invoiceNumber: "",
          amount: "",
          date: "",
          documentType: "",
          fileSha256: "",
          organizationId: "org-te",
        },
      },
      moneyDecision: moneyDecision({ status: "rejected", confidence: 0.05, isStrongEnoughForAutoSave: false }),
      supplierDecision: supplierDecision({ status: "rejected", confidence: 0.05, isStrongEnoughForAutoSave: false }),
      fseDecision: {
        ...computeFinancialSanity(fseInput()),
        overallStatus: "warning",
        trustScore: 20,
        confidence: 0.2,
      },
      context: {
        historicalCorrections: 5,
        userCorrectionRate: 0.9,
        ocrQuality: 0.1,
        attachmentQuality: 0.1,
      },
    })
  );

  assert.ok(weak.confidence >= 0);
  assert.ok(weak.confidence <= 100);
});

test("TE: weightedConfidence clamps aggregated score", () => {
  const low = weightedConfidence([
    { engine: "arc", score: 10, weight: 0.5, impact: -80, explanation: "test" },
    { engine: "sir", score: 5, weight: 0.5, impact: -40, explanation: "test" },
  ]);
  const high = weightedConfidence([
    { engine: "arc", score: 98, weight: 0.5, impact: 20, explanation: "test" },
    { engine: "sir", score: 99, weight: 0.5, impact: 15, explanation: "test" },
  ]);

  assert.equal(low, 0);
  assert.equal(high, 100);
});

test("TE: evaluateArcContributor flags ambiguity", () => {
  const arc = evaluateArcContributor(
    moneyDecision({
      status: "ambiguous",
      ambiguityFlags: ["multiple_totals"],
    })
  );

  assert.equal(arc.requestsReview, true);
  assert.ok(arc.uncertaintyFlags.includes("arc_ambiguous"));
  assert.ok(arc.uncertaintyFlags.includes("arc_multiple_totals"));
});

test("TE: evaluateFseContributor marks critical failure on error", () => {
  const fse = evaluateFseContributor({
    ...computeFinancialSanity(fseInput()),
    overallStatus: "error",
    trustScore: 10,
    errors: [{ ruleId: "future_invoice_date", severity: "error", passed: false, message: "future" }],
    warnings: [],
    failedRules: ["future_invoice_date"],
    passedRules: [],
    confidence: 0.1,
    recommendation: "block",
    explanation: "error",
    version: FSE_VERSION,
    ruleResults: [],
  });

  assert.equal(fse.criticalFailure, true);
  assert.equal(fse.requestsReview, false);
});

test("TE: duplicate risk high requests review through SCFC", () => {
  const decision = computeTrustDecision(
    trustInput({
      context: {
        duplicateRisk: "high",
      },
    })
  );

  assert.equal(decision.decision, "NEEDS_REVIEW");
  assert.equal(decision.reasonCode, "TE_UPSTREAM_REVIEW");
});
