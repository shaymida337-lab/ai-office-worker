import test from "node:test";
import assert from "node:assert/strict";

import type { ScannerHealthApiResponse } from "../scanner/scannerHealthService.js";
import { emptyDecisionBucketCounts } from "../scanner/scannerHealthQueries.js";
import type { ScannerIsolationViolation } from "../scanner/scannerIsolationChecks.js";
import {
  adaptScannerHealthToSubsystemContract,
  buildReliabilityDashboardWithScanner,
  buildScannerReliabilityContribution,
  mapScannerViolationsToReliabilityEvents,
  mergeScannerIntoReliabilityDashboard,
  validateScannerReliabilityContribution,
} from "./scannerReliabilityAdapter.js";
import { buildReliabilityDashboardSnapshot } from "./reliabilityDashboard.js";
import { getReliabilityRegistryEntry, validateReliabilityRegistryIntegrity } from "./reliabilityRegistry.js";
import { validateReliabilityEvent, validateSubsystemHealthContract } from "./reliabilityValidation.js";

const ORG = "org-scanner-integration";
const GENERATED_AT = "2026-07-01T12:00:00.000Z";

function sampleHealthResponse(overrides: Partial<ScannerHealthApiResponse> = {}): ScannerHealthApiResponse {
  return {
    organizationId: ORG,
    generatedAt: GENERATED_AT,
    range: {
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-01T23:59:59.999Z",
    },
    health: {
      organizationId: ORG,
      range: {
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-01T23:59:59.999Z",
      },
      ingestion: {
        emailsIngested: 58,
        emailsProcessed: 58,
        ingestionSuccessRate: 1,
      },
      artifacts: {
        gmailScanItemCount: 128,
        financialDocumentReviewCount: 161,
      },
      extraction: {
        financialCandidateCount: 107,
        amountExtractedCount: 66,
        amountExtractionRate: 0.617,
        supplierDetectedCount: 86,
        supplierDetectionRate: 0.804,
        missingAmountCount: 41,
        missingAmountRate: 0.383,
      },
      decisions: emptyDecisionBucketCounts(),
      scans: {
        stuckScanCount: 0,
        scanErrorCount: 104,
      },
    },
    violations: {
      total: 2,
      bySeverity: { critical: 1, warning: 1, info: 0 },
      byType: {
        stuck_active_scan: 0,
        duplicate_supplier_payment_fingerprint: 0,
        blocked_outcome_persisted: 1,
        auto_saved_without_attachment: 0,
        drive_link_invoice_confusion: 0,
        fdr_without_gsi: 1,
        cross_org_gmail_message_id: 0,
        gmail_mailbox_mismatch: 0,
      },
    },
    ...overrides,
  };
}

const sampleViolations: ScannerIsolationViolation[] = [
  {
    severity: "critical",
    violationType: "blocked_outcome_persisted",
    organizationId: ORG,
    affectedIds: ["fdr-1", "pay-1"],
    explanation: "FinancialDocumentReview fdr-1 is BLOCKED but linked SupplierPayment rows exist.",
    recommendedAction: "Treat as isolation breach.",
  },
  {
    severity: "warning",
    violationType: "fdr_without_gsi",
    organizationId: ORG,
    affectedIds: ["fdr-2"],
    explanation: "FinancialDocumentReview fdr-2 exists without a GmailScanItem mirror.",
    recommendedAction: "Verify terminal outcome path.",
  },
  {
    severity: "warning",
    violationType: "cross_org_gmail_message_id",
    organizationId: ORG,
    affectedIds: ["email-1", "email-2"],
    explanation: "Gmail message id(s) abc appear in multiple organizations.",
    recommendedAction: "Confirm Gmail integration isolation.",
  },
];

test("adaptScannerHealthToSubsystemContract maps existing scanner values", () => {
  const response = sampleHealthResponse();
  const contract = adaptScannerHealthToSubsystemContract(response);

  assert.equal(contract.subsystemId, "scanner");
  assert.equal(contract.status, "unhealthy");
  assert.equal(contract.successRate, 1);
  assert.equal(contract.errorRate, 0);
  assert.equal(contract.queueSize, 0);
  assert.equal(contract.retryCount, 104);
  assert.equal(contract.averageProcessingTimeMs, null);
  assert.equal(contract.lastSuccessfulExecutionAt, null);
  assert.equal(contract.lastFailureAt, null);
  assert.equal(contract.activeAlerts, 1);
  assert.equal(contract.warningCount, 1);
  assert.equal(contract.metrics?.availability, 1);
  assert.equal(contract.metrics?.queue_depth, 0);
  assert.equal(contract.metrics?.stuck_jobs, 0);
  assert.equal(contract.checkedAt, GENERATED_AT);
  assert.equal(validateSubsystemHealthContract(contract).valid, true);
});

test("mapScannerViolationsToReliabilityEvents preserves scanner violation semantics", () => {
  const events = mapScannerViolationsToReliabilityEvents(sampleViolations, GENERATED_AT);
  assert.equal(events.length, 3);

  const blocked = events.find((event) => event.message === "blocked_outcome_persisted");
  assert.ok(blocked);
  assert.equal(blocked?.severity, "CRITICAL");
  assert.equal(blocked?.subsystem, "scanner");
  assert.equal(blocked?.stage, "decision");
  assert.equal(blocked?.organizationId, ORG);
  assert.equal(blocked?.entityId, "fdr-1");
  assert.equal(blocked?.correlationId, "scanner:blocked_outcome_persisted:fdr-1");
  assert.equal(blocked?.probableRootCause, sampleViolations[0]?.explanation);
  assert.equal(blocked?.suggestedAction, sampleViolations[0]?.recommendedAction);
  assert.equal(blocked?.autoRecoverable, false);

  const stuck = mapScannerViolationsToReliabilityEvents([
    {
      severity: "critical",
      violationType: "stuck_active_scan",
      organizationId: ORG,
      affectedIds: ["scan-1"],
      explanation: "stuck",
      recommendedAction: "resume",
    },
  ])[0];
  assert.equal(stuck?.autoRecoverable, true);
  assert.equal(stuck?.stage, "ingestion");

  for (const event of events) {
    assert.equal(validateReliabilityEvent(event).valid, true);
  }
});

test("scanner registry entry is active and dashboard-compatible", () => {
  const entry = getReliabilityRegistryEntry("scanner");
  assert.ok(entry);
  assert.equal(entry?.monitored, true);
  assert.equal(entry?.placeholder, false);
  assert.ok(entry?.recovery);
  assert.equal(validateReliabilityRegistryIntegrity().valid, true);
});

test("buildScannerReliabilityContribution validates end-to-end", () => {
  const contribution = buildScannerReliabilityContribution({
    healthResponse: sampleHealthResponse(),
    violations: sampleViolations,
  });
  const validation = validateScannerReliabilityContribution(contribution);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(contribution.events.length, 3);
  assert.ok(contribution.metricSamples.length >= 9);
});

test("dashboard snapshot contains scanner panel with live contract", () => {
  const snapshot = buildReliabilityDashboardWithScanner({
    healthResponse: sampleHealthResponse({ violations: { ...sampleHealthResponse().violations, total: 0, bySeverity: { critical: 0, warning: 0, info: 0 } } }),
    violations: [],
  });

  const scannerPanel = snapshot.subsystems.find((panel) => panel.contract.subsystemId === "scanner");
  assert.ok(scannerPanel);
  assert.equal(scannerPanel.contract.status, "healthy");
  assert.equal(scannerPanel.contract.successRate, 1);
  assert.equal(scannerPanel.recentEvents.length, 0);
  assert.equal(scannerPanel.recovery.subsystemId, "scanner");
  assert.equal(scannerPanel.recovery.canRetry, true);
});

test("mergeScannerIntoReliabilityDashboard replaces default scanner placeholder", () => {
  const base = buildReliabilityDashboardSnapshot({ organizationId: ORG, generatedAt: GENERATED_AT });
  const before = base.subsystems.find((panel) => panel.contract.subsystemId === "scanner");
  assert.equal(before?.contract.status, "not_configured");

  const contribution = buildScannerReliabilityContribution({
    healthResponse: sampleHealthResponse(),
    violations: sampleViolations,
  });
  const merged = mergeScannerIntoReliabilityDashboard(base, contribution.panel);
  const after = merged.subsystems.find((panel) => panel.contract.subsystemId === "scanner");
  assert.equal(after?.contract.status, "unhealthy");
  assert.equal(after?.recentEvents.length, 3);
  assert.equal(merged.rollup.activeAlerts, 1);
});

test("legacy scanner health payload shape is unchanged by adapter layer", () => {
  const response = sampleHealthResponse();
  const original = JSON.stringify(response);
  adaptScannerHealthToSubsystemContract(response);
  mapScannerViolationsToReliabilityEvents(sampleViolations);
  assert.equal(JSON.stringify(response), original);
});
