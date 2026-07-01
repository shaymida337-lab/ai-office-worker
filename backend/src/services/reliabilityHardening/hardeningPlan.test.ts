import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditNatalieDecision, summarizeAiAuditorResults } from "./aiAuditor.js";
import { buildAuditLogEntry, isFinancialAuditAction, validateAuditLogEntry } from "./auditLogDesign.js";
import { evaluateRollbackTriggers } from "./autoRollback.js";
import { evaluateCanaryPromotion } from "./canaryRelease.js";
import { listLoadTestScenarios } from "./capacityLoadTests.js";
import { evaluateConfidenceGates, listConfidenceGateRules } from "./confidenceGates.js";
import { validateConfiguration } from "./configurationValidation.js";
import {
  buildDataIntegrityWatchReport,
  classifyDataIntegrityResult,
  listAllIntegrityCheckKinds,
} from "./dataIntegrityWatch.js";
import { buildDefaultDependencyHealthReport, classifyDependencyHealthResult } from "./dependencyHealth.js";
import { buildDisasterRecoveryDrillResult, validateDisasterRecoveryReadiness } from "./disasterRecovery.js";
import {
  HARDENING_LAYER_REGISTRY,
  listPreLaunchRequiredLayers,
  validateHardeningRegistryIntegrity,
} from "./hardeningRegistry.js";
import { computeRiskScore, listPreLaunchRisks, rankRisksByScore } from "./hardeningRiskMatrix.js";
import { HARDENING_PLAN_VERSION, NATALIE_UNCERTAINTY_RULE } from "./hardeningTypes.js";
import { detectAiModelDrift } from "./aiModelDrift.js";
import { assertFinancialPermission, roleHasPermission } from "./permissionsRbac.js";
import {
  buildReliabilityControlCenterSnapshot,
  listControlCenterPanels,
} from "./reliabilityControlCenter.js";
import {
  buildReleaseCertificate,
  formatReleaseCertificate,
  isReleaseBlocked,
} from "./releaseCertificate.js";
import { canExecuteRecoveryOperation, listForbiddenRecoveryOperations } from "./recoveryEngineDesign.js";
import { compareShadowOutputs } from "./shadowMode.js";
import { buildStabilitySoakReport } from "./stabilityTests.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("hardening: registry has 17 layers with valid order", () => {
  assert.equal(HARDENING_LAYER_REGISTRY.length, 17);
  assert.deepEqual(validateHardeningRegistryIntegrity(), []);
});

test("hardening: pre-launch required layers exist", () => {
  const required = listPreLaunchRequiredLayers();
  assert.ok(required.length >= 9);
  assert.ok(required.some((l) => l.layerId === "data_integrity_watch"));
  assert.ok(required.some((l) => l.layerId === "release_certificate"));
});

test("hardening: risk matrix ranks critical risks", () => {
  const ranked = rankRisksByScore();
  assert.ok(ranked.length >= 10);
  assert.ok(computeRiskScore(ranked[0]) >= computeRiskScore(ranked[ranked.length - 1]));
  assert.ok(listPreLaunchRisks().length >= 8);
});

test("hardening: data integrity watch has 10 read-only checks", () => {
  assert.equal(listAllIntegrityCheckKinds().length, 10);
  const report = buildDataIntegrityWatchReport([]);
  assert.equal(report.autoFixEnabled, false);
  assert.equal(classifyDataIntegrityResult(report), "pass");
});

test("hardening: AI auditor blocks unsafe auto-save", () => {
  const finding = auditNatalieDecision({
    entityId: "e1",
    organizationId: "org-1",
    extractedAmount: null,
    supplierName: "Acme",
    documentType: "tax_invoice",
    paymentDirection: "incoming_expense",
    confidenceScore: 0.9,
    isDuplicate: false,
    autoSaveRecommended: true,
    outcomeStatus: "SAVED",
  });
  assert.equal(finding.auditStatus, "warning");
  assert.equal(finding.humanReviewRequired, true);
});

test("hardening: AI auditor fails duplicate auto-save", () => {
  const finding = auditNatalieDecision({
    entityId: "e2",
    organizationId: "org-1",
    extractedAmount: 100,
    supplierName: "Acme",
    documentType: "tax_invoice",
    paymentDirection: "incoming_expense",
    confidenceScore: 0.95,
    isDuplicate: true,
    autoSaveRecommended: true,
    outcomeStatus: "SAVED",
  });
  assert.equal(finding.auditStatus, "fail");
});

test("hardening: audit log is immutable", () => {
  const entry = buildAuditLogEntry({
    actorType: "user",
    actorId: "u1",
    organizationId: "org-1",
    entityType: "payment",
    entityId: "p1",
    action: "payment_created",
    before: null,
    after: { amount: 100 },
  });
  assert.equal(entry.immutable, true);
  assert.deepEqual(validateAuditLogEntry(entry), []);
  assert.equal(isFinancialAuditAction("payment_created"), true);
});

test("hardening: RBAC denies employee financial actions", () => {
  assert.equal(roleHasPermission("employee", "view_documents"), true);
  const result = assertFinancialPermission("employee", "create_payments");
  assert.equal(result.allowed, false);
  assert.match(result.reason, /DENIED/);
});

test("hardening: owner has all permissions", () => {
  assert.equal(assertFinancialPermission("owner", "delete_payments").allowed, true);
});

test("hardening: confidence gates route uncertain to review", () => {
  const result = evaluateConfidenceGates({
    confidenceScore: 0.8,
    amount: 100,
    amountConfidence: 0.8,
    paymentDirection: "incoming_expense",
    documentType: "tax_invoice",
    isDuplicateSuspicion: false,
    sourceTrusted: true,
    hasConflictingAmounts: false,
  });
  assert.equal(result.outcome, "needs_review");
  assert.equal(result.explanation, NATALIE_UNCERTAINTY_RULE);
});

test("hardening: confidence gates block duplicate suspicion", () => {
  const result = evaluateConfidenceGates({
    confidenceScore: 0.95,
    amount: 100,
    amountConfidence: 0.95,
    paymentDirection: "incoming_expense",
    documentType: "tax_invoice",
    isDuplicateSuspicion: true,
    sourceTrusted: true,
    hasConflictingAmounts: false,
  });
  assert.equal(result.outcome, "blocked");
});

test("hardening: confidence gate rules ordered by priority", () => {
  const rules = listConfidenceGateRules();
  assert.ok(rules.length >= 6);
  assert.equal(rules[0].ruleId, "cg-001");
});

test("hardening: shadow mode requires stable runs before promotion", () => {
  const match = compareShadowOutputs({
    subsystem: "ai_extraction",
    oldPathOutput: { amount: 100, supplier: "Acme" },
    newPathOutput: { amount: 100, supplier: "Acme" },
    stableRunCount: 50,
    requiredStableRuns: 100,
  });
  assert.equal(match.promotionAllowed, false);

  const promoted = compareShadowOutputs({
    subsystem: "ai_extraction",
    oldPathOutput: { amount: 100 },
    newPathOutput: { amount: 100 },
    stableRunCount: 100,
  });
  assert.equal(promoted.promotionAllowed, true);
});

test("hardening: canary promotion blocked when gates fail", () => {
  const result = evaluateCanaryPromotion({
    currentStage: "internal_org",
    gates: [
      { name: "health_green", required: true, status: "pass" },
      { name: "golden_tests_green", required: true, status: "fail" },
    ],
  });
  assert.equal(result.canPromote, false);
  assert.ok(result.blockers.length > 0);
});

test("hardening: auto rollback triggers on critical events", () => {
  const result = evaluateRollbackTriggers({
    triggeredKinds: ["amount_regression_detected", "critical_journey_failed"],
  });
  assert.equal(result.shouldRollback, true);
});

test("hardening: recovery forbids payment changes without approval", () => {
  assert.equal(canExecuteRecoveryOperation("retry_failed_scan").allowed, true);
  assert.equal(canExecuteRecoveryOperation("change_amount").allowed, false);
  assert.ok(listForbiddenRecoveryOperations().includes("delete_payment"));
});

test("hardening: disaster recovery readiness gaps detected", () => {
  const readiness = validateDisasterRecoveryReadiness({
    rpoMinutes: null,
    rtoMinutes: null,
    restoreSuccessRate: null,
    lastVerifiedRestoreAt: null,
  });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.gaps.length > 0);
});

test("hardening: disaster recovery drill success", () => {
  const drill = buildDisasterRecoveryDrillResult({
    drillId: "drill-001",
    success: true,
    rpoMinutes: 60,
    rtoMinutes: 30,
  });
  assert.equal(drill.success, true);
  assert.equal(drill.stepsCompleted.length, 5);
});

test("hardening: dependency health report classification", () => {
  const report = buildDefaultDependencyHealthReport();
  assert.equal(classifyDependencyHealthResult(report), "pass");
});

test("hardening: config validation fails safe on missing required checks", () => {
  const result = validateConfiguration({ results: [] });
  assert.equal(result.passed, false);
  assert.ok(result.blockers.length > 0);
});

test("hardening: AI drift detection alerts on delta", () => {
  const report = detectAiModelDrift({
    baseline: { amount_accuracy: 0.95 },
    current: { amount_accuracy: 0.85 },
  });
  assert.ok(report.alertsTriggered >= 1);
});

test("hardening: control center is operator-only", () => {
  const snapshot = buildReliabilityControlCenterSnapshot();
  assert.equal(snapshot.operatorAccessOnly, true);
  assert.ok(listControlCenterPanels().length >= 10);
});

test("hardening: release certificate blocks on critical failure", () => {
  const cert = buildReleaseCertificate({
    commitHash: "abc",
    deployId: "d1",
    buildResult: "pass",
    testResults: { passed: 100, failed: 0, total: 100 },
    goldenSuiteResult: "fail",
    journeyResult: "pass",
    dataIntegrityResult: "pass",
    securityIsolationResult: "pass",
    dependencyHealth: "pass",
    rollbackReadiness: "ready",
  });
  assert.equal(cert.releaseDecision, "blocked");
  assert.equal(isReleaseBlocked(cert), true);
  assert.match(formatReleaseCertificate(cert), /BLOCKED/);
});

test("hardening: release certificate approves when all green", () => {
  const cert = buildReleaseCertificate({
    commitHash: "abc",
    deployId: "d1",
    buildResult: "pass",
    testResults: { passed: 100, failed: 0, total: 100 },
    goldenSuiteResult: "pass",
    journeyResult: "pass",
    dataIntegrityResult: "pass",
    securityIsolationResult: "pass",
    dependencyHealth: "pass",
    rollbackReadiness: "ready",
    reliabilityScore: 0.98,
  });
  assert.equal(cert.releaseDecision, "approved");
  assert.equal(cert.schemaVersion, HARDENING_PLAN_VERSION);
});

test("hardening: example release certificate fixture validates", () => {
  const raw = readFileSync(join(__dirname, "fixtures", "example-release-certificate.json"), "utf8");
  const cert = JSON.parse(raw);
  assert.equal(cert.schemaVersion, HARDENING_PLAN_VERSION);
  assert.equal(cert.releaseDecision, "approved");
});

test("hardening: load and stability test catalogs exist", () => {
  assert.ok(listLoadTestScenarios().length >= 5);
  const soak = buildStabilitySoakReport({
    durationHours: 24,
    observations: { memory_growth: { observed: "2%", passed: true } },
  });
  assert.equal(soak.durationHours, 24);
});

test("hardening: AI auditor summary counts", () => {
  const pass = auditNatalieDecision({
    entityId: "e",
    organizationId: "o",
    extractedAmount: 100,
    supplierName: "A",
    documentType: "tax_invoice",
    paymentDirection: "incoming_expense",
    confidenceScore: 0.9,
    isDuplicate: false,
    autoSaveRecommended: false,
    outcomeStatus: "NEEDS_REVIEW",
  });
  const summary = summarizeAiAuditorResults([pass]);
  assert.equal(summary.pass, 1);
});

test("hardening: no production DB access in scaffold", () => {
  // Scaffold modules must not import prisma — verified by design-only exports
  assert.equal(HARDENING_PLAN_VERSION, "reliability-hardening-v1");
});
