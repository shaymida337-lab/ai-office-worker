import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  evaluateConfidenceDecision,
  evaluateAndRecordConfidenceDecision,
  aggregateConfidenceEvidence,
  parseConfidenceThresholdsJson,
  buildConfidenceTrustContribution,
  emitConfidenceReliabilityEvent,
  resetConfidenceReliabilityDedupeForTests,
} from "./index.js";
import type { ConfidenceEvaluationInput } from "./confidenceTypes.js";

function baseInput(overrides: Partial<ConfidenceEvaluationInput> = {}): ConfidenceEvaluationInput {
  return {
    organizationId: "org-1",
    entityType: "financial_document_review",
    entityId: "review-1",
    correlationId: "gmail:msg-1",
    confidenceScore: 0.95,
    ocrConfidence: 0.9,
    amount: 1200,
    amountConfidence: 0.92,
    supplierName: "Acme Ltd",
    supplierMatchConfidence: 0.9,
    documentType: "tax_invoice",
    paymentDirection: "incoming_expense",
    hasAttachment: true,
    isDuplicateSuspicion: false,
    isConfirmedDuplicate: false,
    hasConflictingAmounts: false,
    missingSupplier: false,
    unsupportedDocument: false,
    corruptedDocument: false,
    sourceTrusted: true,
    permissionDenied: false,
    crossOrgMismatch: false,
    integrityCritical: false,
    integrityWarning: false,
    businessRuleViolations: [],
    aiAuditorObjections: [],
    trustEngineConfidence: 88,
    historicalConsistency: 0.85,
    ...overrides,
  };
}

test("high-confidence invoice → AUTO_EXECUTE at default threshold", () => {
  const result = evaluateConfidenceDecision(baseInput(), DEFAULT_CONFIDENCE_THRESHOLDS);
  assert.equal(result.decision, "AUTO_EXECUTE");
  assert.ok(result.confidenceScore >= DEFAULT_CONFIDENCE_THRESHOLDS.autoExecuteMin);
  assert.equal(result.confidenceLevel, "high");
  assert.ok(result.supportingEvidence.length > 0);
});

test("low-confidence supplier → REVIEW_REQUIRED", () => {
  const result = evaluateConfidenceDecision(
    baseInput({
      confidenceScore: 0.7,
      supplierMatchConfidence: 0.4,
      trustEngineConfidence: 65,
    }),
    DEFAULT_CONFIDENCE_THRESHOLDS,
  );
  assert.equal(result.decision, "REVIEW_REQUIRED");
  assert.match(result.explanation, /Review required|below auto-execute/i);
});

test("cross-org anomaly → BLOCKED", () => {
  const result = evaluateConfidenceDecision(
    baseInput({ crossOrgMismatch: true }),
    DEFAULT_CONFIDENCE_THRESHOLDS,
  );
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.blockingReasons.includes("cross_organization_violation"));
});

test("duplicate suspicion → REVIEW_REQUIRED", () => {
  const result = evaluateConfidenceDecision(
    baseInput({ isDuplicateSuspicion: true }),
    DEFAULT_CONFIDENCE_THRESHOLDS,
  );
  assert.equal(result.decision, "REVIEW_REQUIRED");
  assert.match(result.explanation, /duplicate_suspicion/);
});

test("threshold boundaries respect configuration overrides", () => {
  const custom = { autoExecuteMin: 0.8, reviewRequiredMin: 0.5, blockedBelow: 0.5 };
  const atThreshold = evaluateConfidenceDecision(baseInput({ confidenceScore: 0.82 }), custom);
  assert.equal(atThreshold.decision, "AUTO_EXECUTE");

  const belowAuto = evaluateConfidenceDecision(
    baseInput({
      confidenceScore: 0.75,
      ocrConfidence: 0.75,
      amountConfidence: 0.75,
      supplierMatchConfidence: 0.75,
      trustEngineConfidence: 75,
      historicalConsistency: 0.75,
    }),
    custom,
  );
  assert.equal(belowAuto.decision, "REVIEW_REQUIRED");

  const blocked = evaluateConfidenceDecision(
    baseInput({
      confidenceScore: 0.4,
      ocrConfidence: 0.4,
      amountConfidence: 0.4,
      supplierMatchConfidence: 0.4,
      trustEngineConfidence: 40,
      historicalConsistency: 0.4,
    }),
    custom,
  );
  assert.equal(blocked.decision, "BLOCKED");
});

test("parseConfidenceThresholdsJson uses defaults when config missing", () => {
  const parsed = parseConfidenceThresholdsJson(null);
  assert.deepEqual(parsed, DEFAULT_CONFIDENCE_THRESHOLDS);
});

test("parseConfidenceThresholdsJson accepts org overrides", () => {
  const parsed = parseConfidenceThresholdsJson({
    autoExecuteMin: 0.85,
    reviewRequiredMin: 0.55,
    blockedBelow: 0.55,
  });
  assert.equal(parsed.autoExecuteMin, 0.85);
  assert.equal(parsed.reviewRequiredMin, 0.55);
});

test("evidence aggregation is deterministic", () => {
  const input = baseInput();
  const first = aggregateConfidenceEvidence(input);
  const second = aggregateConfidenceEvidence(input);
  assert.equal(first.finalScore, second.finalScore);
  assert.equal(first.supportingEvidence.length, second.supportingEvidence.length);
});

test("blocked execution emits CRITICAL reliability for integrity critical", () => {
  resetConfidenceReliabilityDedupeForTests();
  const result = evaluateConfidenceDecision(
    baseInput({ integrityCritical: true }),
    DEFAULT_CONFIDENCE_THRESHOLDS,
  );
  const event = emitConfidenceReliabilityEvent({
    organizationId: "org-1",
    entityType: "financial_document_review",
    entityId: "review-1",
    result,
    correlationId: "gmail:msg-1",
  });
  assert.equal(event?.severity, "CRITICAL");
});

test("low confidence emits IMPORTANT reliability event", () => {
  resetConfidenceReliabilityDedupeForTests();
  const result = evaluateConfidenceDecision(baseInput({ confidenceScore: 0.5 }), DEFAULT_CONFIDENCE_THRESHOLDS);
  const event = emitConfidenceReliabilityEvent({
    organizationId: "org-1",
    entityType: "financial_document_review",
    entityId: "review-1",
    result,
    correlationId: null,
  });
  assert.equal(event?.severity, "IMPORTANT");
  assert.equal(event?.stage, "confidence_gate");
});

test("confidence result is explainable with evidence and recommended action", () => {
  const result = evaluateConfidenceDecision(
    baseInput({ missingSupplier: true, supplierName: null }),
    DEFAULT_CONFIDENCE_THRESHOLDS,
  );
  assert.ok(result.explanation.length > 0);
  assert.ok(result.recommendedAction.length > 0);
  assert.match(result.explanation, /missing_supplier|Review required/i);
});

test("buildConfidenceTrustContribution marks decision evidence", () => {
  const result = evaluateConfidenceDecision(baseInput(), DEFAULT_CONFIDENCE_THRESHOLDS);
  const trust = buildConfidenceTrustContribution(result);
  assert.equal(trust.contributesToDecisionEvidence, true);
  assert.equal(trust.decision, "AUTO_EXECUTE");
});

test("evaluateAndRecordConfidenceDecision returns same result as evaluate", () => {
  const input = baseInput({ confidenceScore: 0.7 });
  const direct = evaluateConfidenceDecision(input, DEFAULT_CONFIDENCE_THRESHOLDS);
  const recorded = evaluateAndRecordConfidenceDecision(input, DEFAULT_CONFIDENCE_THRESHOLDS);
  assert.equal(recorded.decision, direct.decision);
  assert.equal(recorded.confidenceScore, direct.confidenceScore);
});

test("permission denied → BLOCKED", () => {
  const result = evaluateConfidenceDecision(baseInput({ permissionDenied: true }), DEFAULT_CONFIDENCE_THRESHOLDS);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.blockingReasons.includes("permission_denied"));
});
