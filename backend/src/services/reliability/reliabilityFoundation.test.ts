import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptLegacySystemComponentToHealthContract,
  adaptLegacySystemHealthResponse,
} from "./legacyAdapters.js";
import { buildReliabilityDashboardSnapshot } from "./reliabilityDashboard.js";
import { buildReliabilityEvent, isReliabilityEvent } from "./reliabilityEventModel.js";
import {
  buildSubsystemHealthContract,
  deriveHealthStatusFromRates,
  emptySubsystemHealthContract,
  isSubsystemHealthContract,
} from "./reliabilityHealthContract.js";
import {
  buildReliabilityMetricSample,
  buildStandardMetricSet,
  validateReliabilityMetricSample,
} from "./reliabilityMetrics.js";
import {
  declareSubsystemRecoveryCapabilities,
  defaultRecoveryCapabilities,
  validateRecoveryFrameworkDeclaration,
} from "./reliabilityRecoveryFramework.js";
import {
  RELIABILITY_REGISTRY,
  getReliabilityRegistryEntry,
  listMonitoredReliabilitySubsystems,
  validateReliabilityRegistryIntegrity,
} from "./reliabilityRegistry.js";
import {
  RELIABILITY_DASHBOARD_SCHEMA_VERSION,
  RELIABILITY_EVENT_SEVERITIES,
  RELIABILITY_HEALTH_STATUSES,
  RELIABILITY_STANDARD_METRIC_KEYS,
  RELIABILITY_SUBSYSTEM_IDS,
} from "./reliabilityTypes.js";
import {
  validateReliabilityEvent,
  validateReliabilityFoundation,
  validateSubsystemHealthContract,
} from "./reliabilityValidation.js";

test("health contract includes all required operational fields", () => {
  const contract = buildSubsystemHealthContract({
    subsystemId: "gmail",
    status: "healthy",
    successRate: 0.98,
    errorRate: 0.02,
    queueSize: 3,
    retryCount: 1,
    averageProcessingTimeMs: 4200,
    lastSuccessfulExecutionAt: "2026-07-01T10:00:00.000Z",
    lastFailureAt: "2026-07-01T09:00:00.000Z",
    activeAlerts: 0,
    warningCount: 2,
    checkedAt: "2026-07-01T12:00:00.000Z",
  });

  assert.equal(contract.subsystemId, "gmail");
  assert.equal(contract.successRate, 0.98);
  assert.equal(contract.errorRate, 0.02);
  assert.equal(contract.queueSize, 3);
  assert.equal(contract.retryCount, 1);
  assert.equal(contract.averageProcessingTimeMs, 4200);
  assert.equal(contract.lastSuccessfulExecutionAt, "2026-07-01T10:00:00.000Z");
  assert.equal(contract.lastFailureAt, "2026-07-01T09:00:00.000Z");
  assert.equal(contract.activeAlerts, 0);
  assert.equal(contract.warningCount, 2);
  assert.ok(isSubsystemHealthContract(contract));
  assert.equal(validateSubsystemHealthContract(contract).valid, true);
});

test("health contract clamps invalid rates and normalizes counts", () => {
  const contract = buildSubsystemHealthContract({
    subsystemId: "scanner",
    successRate: 1.5,
    errorRate: -0.1,
    queueSize: 2.8,
    retryCount: -3,
    averageProcessingTimeMs: -10,
  });
  assert.equal(contract.successRate, 1);
  assert.equal(contract.errorRate, 0);
  assert.equal(contract.queueSize, 2);
  assert.equal(contract.retryCount, 0);
  assert.equal(contract.averageProcessingTimeMs, 0);
});

test("deriveHealthStatusFromRates maps alerts and error thresholds", () => {
  assert.equal(
    deriveHealthStatusFromRates({ successRate: 0.99, errorRate: 0.01, activeAlerts: 0, warningCount: 0 }),
    "healthy",
  );
  assert.equal(
    deriveHealthStatusFromRates({ successRate: 0.9, errorRate: 0.1, activeAlerts: 0, warningCount: 1 }),
    "degraded",
  );
  assert.equal(
    deriveHealthStatusFromRates({ successRate: 0.5, errorRate: 0.5, activeAlerts: 1, warningCount: 0 }),
    "unhealthy",
  );
});

test("reliability event schema supports all severities and required fields", () => {
  for (const severity of RELIABILITY_EVENT_SEVERITIES) {
    const event = buildReliabilityEvent({
      subsystem: "payments",
      stage: "persist",
      severity,
      organizationId: "org-1",
      entityId: "pay-1",
      correlationId: "corr-1",
      probableRootCause: "duplicate fingerprint",
      suggestedAction: "review manually",
      autoRecoverable: false,
      message: "test",
      timestamp: "2026-07-01T12:00:00.000Z",
    });
    assert.ok(isReliabilityEvent(event));
    assert.equal(validateReliabilityEvent(event).valid, true);
    assert.equal(event.severity, severity);
    assert.equal(event.autoRecoverable, false);
  }
});

test("registry lists all required subsystems with integrity", () => {
  const integrity = validateReliabilityRegistryIntegrity();
  assert.equal(integrity.valid, true, integrity.errors.join("; "));
  assert.equal(RELIABILITY_REGISTRY.length, RELIABILITY_SUBSYSTEM_IDS.length);
  assert.ok(getReliabilityRegistryEntry("scanner"));
  assert.ok(getReliabilityRegistryEntry("whatsapp")?.placeholder);
  assert.ok(getReliabilityRegistryEntry("voice")?.placeholder);
  assert.equal(listMonitoredReliabilitySubsystems().length, 4);
});

test("registry placeholder subsystems are not monitored", () => {
  for (const entry of RELIABILITY_REGISTRY) {
    if (entry.placeholder) assert.equal(entry.monitored, false);
  }
});

test("recovery framework declares capabilities without implementing actions", () => {
  const caps = declareSubsystemRecoveryCapabilities({
    subsystemId: "gmail",
    canRetry: true,
    canRestart: true,
    canRequeue: false,
    needsHumanReview: true,
    safeAutomaticRecovery: false,
  });
  assert.equal(caps.canRetry, true);
  assert.equal(caps.safeAutomaticRecovery, false);
  assert.equal(validateRecoveryFrameworkDeclaration(caps).valid, true);

  const invalid = declareSubsystemRecoveryCapabilities({
    subsystemId: "tasks",
    canRetry: false,
    canRestart: false,
    canRequeue: false,
    needsHumanReview: false,
    safeAutomaticRecovery: true,
  });
  assert.equal(validateRecoveryFrameworkDeclaration(invalid).valid, false);
});

test("default recovery capabilities require human review", () => {
  const caps = defaultRecoveryCapabilities("invoice_creation");
  assert.equal(caps.needsHumanReview, true);
  assert.equal(caps.safeAutomaticRecovery, false);
});

test("standard metrics validate units and ratio bounds", () => {
  const sample = buildReliabilityMetricSample({
    subsystemId: "scanner",
    key: "success_rate",
    value: 0.95,
    recordedAt: "2026-07-01T12:00:00.000Z",
  });
  assert.equal(validateReliabilityMetricSample(sample).valid, true);

  const bad = buildReliabilityMetricSample({
    subsystemId: "scanner",
    key: "failure_rate",
    value: 1.5,
  });
  assert.equal(bad.value, 1);
  assert.equal(validateReliabilityMetricSample(bad).valid, true);
});

test("buildStandardMetricSet covers all standard metric keys", () => {
  const samples = buildStandardMetricSet("outcome_engine", {
    availability: 0.99,
    stuck_jobs: 0,
  });
  assert.equal(samples.length, RELIABILITY_STANDARD_METRIC_KEYS.length);
  assert.ok(samples.every((sample) => validateReliabilityMetricSample(sample).valid));
});

test("dashboard v2 snapshot uses shared schema across subsystems", () => {
  const snapshot = buildReliabilityDashboardSnapshot({
    organizationId: "org-1",
    generatedAt: "2026-07-01T12:00:00.000Z",
  });
  assert.equal(snapshot.schemaVersion, RELIABILITY_DASHBOARD_SCHEMA_VERSION);
  assert.equal(snapshot.subsystems.length, RELIABILITY_SUBSYSTEM_IDS.length);
  assert.equal(snapshot.rollup.totalSubsystems, RELIABILITY_SUBSYSTEM_IDS.length);
  for (const panel of snapshot.subsystems) {
    assert.ok(isSubsystemHealthContract(panel.contract));
    assert.equal(panel.recentEvents.length, 0);
    assert.ok(panel.recovery.subsystemId === panel.contract.subsystemId);
  }
});

test("legacy system health adapter preserves backward compatibility", () => {
  const pass = adaptLegacySystemComponentToHealthContract({
    name: "gmail",
    label: "Gmail",
    connected: true,
    status: "PASS",
    reason: null,
  });
  assert.ok(pass);
  assert.equal(pass?.status, "healthy");
  assert.equal(pass?.successRate, 1);

  const fail = adaptLegacySystemComponentToHealthContract({
    name: "whatsapp",
    label: "WhatsApp",
    connected: false,
    status: "FAIL",
    reason: "not configured",
  });
  assert.ok(fail);
  assert.equal(fail?.status, "unhealthy");
  assert.equal(fail?.activeAlerts, 1);

  const adapted = adaptLegacySystemHealthResponse({
    checkedAt: "2026-07-01T12:00:00.000Z",
    components: {
      gmail: {
        name: "gmail",
        label: "Gmail",
        connected: true,
        status: "PASS",
        reason: null,
      },
    },
  });
  assert.equal(adapted.length, 1);
  assert.equal(adapted[0]?.subsystemId, "gmail");
});

test("empty health contract defaults to not_configured", () => {
  const contract = emptySubsystemHealthContract("calendar");
  assert.equal(contract.status, "not_configured");
  assert.equal(validateSubsystemHealthContract(contract).valid, true);
});

test("reliability foundation validation passes", () => {
  const result = validateReliabilityFoundation();
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("health status enum is stable", () => {
  assert.deepEqual(RELIABILITY_HEALTH_STATUSES, [
    "healthy",
    "degraded",
    "unhealthy",
    "unknown",
    "not_configured",
  ]);
});
