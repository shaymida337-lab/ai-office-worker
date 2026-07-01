import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_AUDITOR_CONFIG,
  comparePrimaryVsAuditor,
  detectComparisonDifferences,
  evaluateAuditorDecision,
  evaluateAuditorReport,
  evaluateAndRecordAuditorReport,
  combineConfidenceWithAuditor,
  buildAuditorTrustContribution,
  emitAuditorReliabilityEvent,
  resetAuditorReliabilityDedupeForTests,
  parseAuditorConfigJson,
} from "./index.js";
import type { AuditorEvaluationInput } from "./auditorTypes.js";

function baseInput(overrides: Partial<AuditorEvaluationInput> = {}): AuditorEvaluationInput {
  return {
    primary: {
      organizationId: "org-1",
      entityType: "financial_document_review",
      entityId: "review-1",
      correlationId: "gmail:msg-1",
      supplierName: "Acme Ltd",
      amount: 1200,
      invoiceNumber: "INV-1001",
      documentType: "tax_invoice",
      paymentDirection: "incoming_expense",
      confidenceScore: 0.92,
      isFinancial: true,
      isDuplicate: false,
      isDuplicateSuspicion: false,
      autoExecuteRecommended: true,
      crossOrgMismatch: false,
    },
    independent: {
      supplierName: "Acme Ltd",
      amount: 1200,
      invoiceNumber: "INV-1001",
      documentType: "tax_invoice",
      paymentDirection: "incoming_expense",
      confidenceScore: 0.9,
      isFinancial: true,
      isDuplicate: false,
      isDuplicateSuspicion: false,
    },
    ...overrides,
  };
}

test("agreement → PASS", () => {
  const input = baseInput();
  const auditor = evaluateAuditorDecision(input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(auditor.auditorDecision, "PASS");
  const comparison = comparePrimaryVsAuditor(input.primary, auditor, input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(comparison.agrees, true);
  assert.equal(comparison.differences.length, 0);
});

test("amount disagreement → FAIL", () => {
  const input = baseInput({
    independent: { ...baseInput().independent, amount: 900 },
  });
  const auditor = evaluateAuditorDecision(input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(auditor.auditorDecision, "FAIL");
  const comparison = comparePrimaryVsAuditor(input.primary, auditor, input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(comparison.amountMismatch, true);
  assert.ok(comparison.differences.some((d) => d.field === "amount"));
});

test("supplier disagreement → FAIL when supplier match required", () => {
  const input = baseInput({
    independent: { ...baseInput().independent, supplierName: "Other Corp" },
  });
  const auditor = evaluateAuditorDecision(input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(auditor.auditorDecision, "FAIL");
  const comparison = comparePrimaryVsAuditor(input.primary, auditor, input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(comparison.supplierMismatch, true);
});

test("supplier disagreement → WARNING when supplier match not required", () => {
  const config = { ...DEFAULT_AUDITOR_CONFIG, supplierMatchRequired: false };
  const input = baseInput({
    independent: { ...baseInput().independent, supplierName: "Other Corp" },
  });
  const auditor = evaluateAuditorDecision(input, config);
  assert.equal(auditor.auditorDecision, "WARNING");
});

test("duplicate disagreement → FAIL", () => {
  const input = baseInput({
    independent: { ...baseInput().independent, isDuplicate: true },
  });
  const auditor = evaluateAuditorDecision(input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(auditor.auditorDecision, "FAIL");
  const comparison = comparePrimaryVsAuditor(input.primary, auditor, input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(comparison.duplicateMismatch, true);
});

test("classification disagreement → FAIL", () => {
  const input = baseInput({
    independent: {
      ...baseInput().independent,
      documentType: "non_financial",
      isFinancial: false,
    },
  });
  const auditor = evaluateAuditorDecision(input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(auditor.auditorDecision, "FAIL");
  const comparison = comparePrimaryVsAuditor(input.primary, auditor, input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(comparison.classificationMismatch, true);
});

test("confidence disagreement → WARNING when no critical conflicts", () => {
  const input = baseInput({
    primary: { ...baseInput().primary, confidenceScore: 0.95 },
    independent: { ...baseInput().independent, confidenceScore: 0.5 },
  });
  const auditor = evaluateAuditorDecision(input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(auditor.auditorDecision, "WARNING");
  const comparison = comparePrimaryVsAuditor(input.primary, auditor, input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(comparison.confidenceMismatch, true);
});

test("cross-org anomaly → FAIL", () => {
  const input = baseInput({
    primary: { ...baseInput().primary, crossOrgMismatch: true },
  });
  const auditor = evaluateAuditorDecision(input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(auditor.auditorDecision, "FAIL");
});

test("comparison is deterministic", () => {
  const input = baseInput({ independent: { ...baseInput().independent, amount: 1100 } });
  const first = detectComparisonDifferences(input, DEFAULT_AUDITOR_CONFIG);
  const second = detectComparisonDifferences(input, DEFAULT_AUDITOR_CONFIG);
  assert.deepEqual(first, second);
});

test("evaluateAuditorReport includes recommendation and confidence hint", () => {
  const report = evaluateAuditorReport(baseInput(), DEFAULT_AUDITOR_CONFIG);
  assert.ok(report.recommendation.length > 0);
  assert.equal(report.confidenceGateHint.autoExecuteBlockedByAuditor, false);
});

test("combineConfidenceWithAuditor is advisory when disabled", () => {
  const report = evaluateAuditorReport(
    baseInput({ independent: { ...baseInput().independent, amount: 500 } }),
    DEFAULT_AUDITOR_CONFIG,
  );
  const combined = combineConfidenceWithAuditor(
    report.primary.confidenceScore,
    report.auditor.auditorConfidence,
    report.comparison,
    DEFAULT_AUDITOR_CONFIG,
  );
  assert.equal(combined.autoExecuteBlockedByAuditor, false);
  assert.equal(combined.combinedConfidence, report.primary.confidenceScore);
});

test("combineConfidenceWithAuditor blocks auto when enabled and critical disagreement", () => {
  const config = { ...DEFAULT_AUDITOR_CONFIG, enabled: true };
  const report = evaluateAuditorReport(
    baseInput({ independent: { ...baseInput().independent, amount: 500 } }),
    config,
  );
  const combined = combineConfidenceWithAuditor(
    report.primary.confidenceScore,
    report.auditor.auditorConfidence,
    report.comparison,
    config,
  );
  assert.equal(combined.autoExecuteBlockedByAuditor, true);
  assert.ok((combined.combinedConfidence ?? 0) < (report.primary.confidenceScore ?? 1));
});

test("financial conflict emits CRITICAL reliability", () => {
  resetAuditorReliabilityDedupeForTests();
  const report = evaluateAuditorReport(
    baseInput({ independent: { ...baseInput().independent, amount: 500 } }),
    DEFAULT_AUDITOR_CONFIG,
  );
  const event = emitAuditorReliabilityEvent({
    organizationId: "org-1",
    entityType: "financial_document_review",
    entityId: "review-1",
    report,
    correlationId: "gmail:msg-1",
  });
  assert.equal(event?.severity, "CRITICAL");
  assert.equal(event?.stage, "ai_auditor");
});

test("non-critical disagreement emits IMPORTANT reliability", () => {
  resetAuditorReliabilityDedupeForTests();
  const report = evaluateAuditorReport(
    baseInput({
      primary: { ...baseInput().primary, confidenceScore: 0.95 },
      independent: { ...baseInput().independent, confidenceScore: 0.5 },
    }),
    DEFAULT_AUDITOR_CONFIG,
  );
  const event = emitAuditorReliabilityEvent({
    organizationId: "org-1",
    entityType: "financial_document_review",
    entityId: "review-1",
    report,
    correlationId: null,
  });
  assert.equal(event?.severity, "IMPORTANT");
});

test("PASS agreement emits no reliability event", () => {
  resetAuditorReliabilityDedupeForTests();
  const report = evaluateAuditorReport(baseInput(), DEFAULT_AUDITOR_CONFIG);
  const event = emitAuditorReliabilityEvent({
    organizationId: "org-1",
    entityType: "financial_document_review",
    entityId: "review-1",
    report,
    correlationId: null,
  });
  assert.equal(event, null);
});

test("buildAuditorTrustContribution marks decision evidence", () => {
  const report = evaluateAuditorReport(baseInput(), DEFAULT_AUDITOR_CONFIG);
  const trust = buildAuditorTrustContribution(report);
  assert.equal(trust.contributesToDecisionEvidence, true);
  assert.equal(trust.contributesToTrustScore, true);
});

test("parseAuditorConfigJson defaults to disabled advisory mode", () => {
  const parsed = parseAuditorConfigJson(null);
  assert.equal(parsed.enabled, false);
  assert.deepEqual(parsed, DEFAULT_AUDITOR_CONFIG);
});

test("evaluateAndRecordAuditorReport returns same outcome as evaluateAuditorReport", () => {
  const input = baseInput();
  const direct = evaluateAuditorReport(input, DEFAULT_AUDITOR_CONFIG);
  const recorded = evaluateAndRecordAuditorReport(input, DEFAULT_AUDITOR_CONFIG);
  assert.equal(recorded.auditor.auditorDecision, direct.auditor.auditorDecision);
  assert.equal(recorded.comparison.agrees, direct.comparison.agrees);
});

test("auditor explains every disagreement", () => {
  const input = baseInput({
    independent: {
      ...baseInput().independent,
      amount: 500,
      supplierName: "Other",
      isDuplicate: true,
    },
  });
  const auditor = evaluateAuditorDecision(input, DEFAULT_AUDITOR_CONFIG);
  assert.ok(auditor.explanation.length > 0);
  assert.ok(auditor.findings.length >= 3);
  for (const finding of auditor.findings) {
    assert.ok(finding.message.length > 0);
  }
});
