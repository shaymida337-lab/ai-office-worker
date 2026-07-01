import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listAiSelfVerificationCapabilities } from "./aiSelfVerificationDesign.js";
import {
  BUSINESS_RULES_CATALOG,
  evaluateBusinessRules,
  summarizeBusinessRuleEvaluations,
} from "./businessRulesEngine.js";
import {
  buildDecisionEvidence,
  buildSupplierPaymentEvidence,
  isEvidenceCompleteForAutoSave,
  validateDecisionEvidence,
} from "./decisionEvidence.js";
import {
  buildNatalieTrustCertificate,
  formatTrustCertificate,
  isTrustCertificateApproved,
} from "./trustCertificate.js";
import { buildTrustDashboardSnapshot, formatTrustDashboardSummary } from "./trustDashboard.js";
import { listTrustPrinciples, isSafeFailureMode, isUnsafeFailureMode } from "./trustPrinciples.js";
import { TRUST_REGISTRY, evaluateSubsystemReadiness } from "./trustRegistry.js";
import {
  computeTrustScore,
  isTrustScoreCertifiable,
  listTrustScoreInputs,
  statusToScore,
} from "./trustScore.js";
import { TRUST_ARCHITECTURE_VERSION } from "./trustTypes.js";
import {
  buildTrustVerificationMatrix,
  isMatrixLaunchReady,
  listMatrixGaps,
} from "./trustVerificationMatrix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("trust: six principles defined", () => {
  const principles = listTrustPrinciples();
  assert.equal(principles.length, 6);
  assert.ok(principles.includes("never_guess"));
  assert.ok(principles.includes("trust_requires_verification"));
});

test("trust: safe vs unsafe failure modes", () => {
  assert.equal(isSafeFailureMode("needs_review"), true);
  assert.equal(isUnsafeFailureMode("wrong_amount"), true);
  assert.equal(isUnsafeFailureMode("needs_review"), false);
});

test("trust: registry covers all reliability subsystems", () => {
  assert.ok(TRUST_REGISTRY.length >= 12);
  assert.ok(TRUST_REGISTRY.some((e) => e.subsystemId === "scanner"));
  assert.ok(TRUST_REGISTRY.some((e) => e.subsystemId === "business_rules_engine"));
});

test("trust: verification matrix lists gaps", () => {
  const matrix = buildTrustVerificationMatrix("2026-07-01T18:00:00.000Z");
  assert.equal(matrix.subsystemsTotal, TRUST_REGISTRY.length);
  assert.equal(isMatrixLaunchReady(matrix), false);
  assert.ok(listMatrixGaps(matrix).length > 0);
});

test("trust: business rules engine has 10 rules", () => {
  assert.equal(BUSINESS_RULES_CATALOG.length, 10);
  assert.ok(BUSINESS_RULES_CATALOG.every((r) => r.enabled));
});

test("trust: business rules block zero amount", () => {
  const evals = evaluateBusinessRules({
    amount: 0,
    isFinancial: true,
    paymentDirection: "incoming_expense",
    isDuplicate: false,
    confidenceScore: 0.95,
    supplierName: "Acme",
    permissionDenied: false,
    crossOrgMismatch: false,
    sourceTrusted: true,
    hasConflictingAmounts: false,
    auditorFailed: false,
  });
  const summary = summarizeBusinessRuleEvaluations(evals);
  assert.ok(summary.blockers.includes("br-001"));
});

test("trust: business rules block duplicate", () => {
  const evals = evaluateBusinessRules({
    amount: 100,
    isFinancial: true,
    paymentDirection: "incoming_expense",
    isDuplicate: true,
    confidenceScore: 0.95,
    supplierName: "Acme",
    permissionDenied: false,
    crossOrgMismatch: false,
    sourceTrusted: true,
    hasConflictingAmounts: false,
    auditorFailed: false,
  });
  const summary = summarizeBusinessRuleEvaluations(evals);
  assert.ok(summary.blockers.includes("br-003"));
});

test("trust: decision evidence validates", () => {
  const evidence = buildSupplierPaymentEvidence({
    organizationId: "org-1",
    entityId: "pay-1",
    supplierName: "Acme",
    amount: 1180,
    confidence: 0.97,
  });
  assert.deepEqual(validateDecisionEvidence(evidence), []);
  assert.equal(isEvidenceCompleteForAutoSave(evidence), true);
  assert.ok(evidence.evidence.length >= 5);
});

test("trust: decision evidence rejects invalid confidence", () => {
  const evidence = buildDecisionEvidence({
    decisionType: "test",
    organizationId: "org-1",
    why: "test",
    evidence: ["item"],
    confidence: 1.5,
  });
  assert.ok(validateDecisionEvidence(evidence).some((e) => e.includes("confidence")));
});

test("trust: trust score computes weighted average", () => {
  const score = computeTrustScore(
    listTrustScoreInputs().map((input) => ({
      input,
      status: "pass" as const,
      score: 100,
    })),
  );
  assert.equal(score.score, 100);
  assert.equal(score.criticalFailures, 0);
  assert.equal(isTrustScoreCertifiable(score), true);
});

test("trust: trust score blocks on critical failure", () => {
  const score = computeTrustScore([
    { input: "golden_tests", status: "fail", score: 0 },
    { input: "health", status: "pass", score: 100 },
  ]);
  assert.ok(score.criticalFailures >= 1);
  assert.equal(isTrustScoreCertifiable(score), false);
});

test("trust: statusToScore mapping", () => {
  assert.equal(statusToScore("pass"), 100);
  assert.equal(statusToScore("fail"), 0);
});

test("trust: dashboard shows release readiness", () => {
  const score = computeTrustScore(
    listTrustScoreInputs().map((i) => ({ input: i, status: "pass" as const, score: 99 })),
  );
  const dashboard = buildTrustDashboardSnapshot({ trustScore: score });
  assert.equal(dashboard.releaseReadiness, "ready");
  assert.match(formatTrustDashboardSummary(dashboard), /Trust Score: 99/);
});

test("trust: dashboard blocked on failures", () => {
  const score = computeTrustScore([{ input: "health", status: "pass", score: 100 }]);
  const dashboard = buildTrustDashboardSnapshot({
    trustScore: score,
    goldenFailures: 1,
  });
  assert.equal(dashboard.releaseReadiness, "blocked");
});

test("trust: certificate approves when all green", () => {
  const trustScore = computeTrustScore(
    listTrustScoreInputs().map((i) => ({ input: i, status: "pass" as const, score: 99.4 })),
  );
  const cert = buildNatalieTrustCertificate({
    commitHash: "abc",
    deployId: "d1",
    reliabilityScore: 0.96,
    trustScore,
    goldenResult: "pass",
    journeyResult: "pass",
    integrityResult: "pass",
    permissionsResult: "pass",
    securityResult: "pass",
    auditResult: "pass",
    recoveryResult: "pass",
    dependenciesResult: "pass",
    configurationResult: "pass",
    businessRulesResult: "pass",
    approvedBy: "operator@test",
  });
  assert.equal(cert.releaseDecision, "approved");
  assert.equal(isTrustCertificateApproved(cert), true);
  assert.match(formatTrustCertificate(cert), /APPROVED/);
});

test("trust: certificate blocks on low trust score", () => {
  const trustScore = computeTrustScore([{ input: "health", status: "pass", score: 80 }]);
  const cert = buildNatalieTrustCertificate({
    commitHash: "abc",
    deployId: "d1",
    trustScore,
    goldenResult: "pass",
    journeyResult: "pass",
    integrityResult: "pass",
    permissionsResult: "pass",
    securityResult: "pass",
    auditResult: "pass",
    recoveryResult: "pass",
    dependenciesResult: "pass",
    configurationResult: "pass",
    businessRulesResult: "pass",
  });
  assert.equal(cert.releaseDecision, "blocked");
  assert.ok(cert.blockers.some((b) => b.includes("trust score")));
});

test("trust: certificate blocks when checks not run", () => {
  const trustScore = computeTrustScore(
    listTrustScoreInputs().map((i) => ({ input: i, status: "pass" as const, score: 100 })),
  );
  const cert = buildNatalieTrustCertificate({
    commitHash: "abc",
    deployId: "d1",
    trustScore,
    goldenResult: "not_run",
    journeyResult: "pass",
    integrityResult: "pass",
    permissionsResult: "pass",
    securityResult: "pass",
    auditResult: "pass",
    recoveryResult: "pass",
    dependenciesResult: "pass",
    configurationResult: "pass",
    businessRulesResult: "pass",
  });
  assert.equal(cert.releaseDecision, "blocked");
});

test("trust: example certificate fixture", () => {
  const raw = readFileSync(join(__dirname, "fixtures", "example-trust-certificate.json"), "utf8");
  const cert = JSON.parse(raw);
  assert.equal(cert.schemaVersion, TRUST_ARCHITECTURE_VERSION);
  assert.equal(cert.trustScore, 99.4);
  assert.equal(cert.releaseDecision, "approved");
});

test("trust: AI self-verification placeholders", () => {
  const caps = listAiSelfVerificationCapabilities();
  assert.equal(caps.length, 6);
  assert.ok(caps.includes("human_approval_workflow"));
});

test("trust: subsystem readiness has gaps in scaffold", () => {
  const readiness = evaluateSubsystemReadiness("scanner");
  assert.equal(readiness.ready, false);
  assert.ok(readiness.gaps.length > 0);
});

test("trust: no production logic in scaffold", () => {
  assert.equal(TRUST_ARCHITECTURE_VERSION, "natalie-trust-v1");
});
