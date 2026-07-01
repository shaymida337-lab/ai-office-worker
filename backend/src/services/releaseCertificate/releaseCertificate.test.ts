import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateReleaseCertificate,
  buildGateResult,
  compareReleaseCertificates,
  emitReleaseCertificateReliabilityEvent,
  resetReleaseCertificateReliabilityDedupeForTests,
  DEFAULT_RELEASE_CERTIFICATE_CONFIG,
} from "./index.js";
import type { ReleaseGateName, ReleaseGateResult } from "./certificateTypes.js";
import { RELEASE_GATE_NAMES } from "./certificateTypes.js";

function allPassGates(): ReleaseGateResult[] {
  return RELEASE_GATE_NAMES.map((name) =>
    buildGateResult({
      name,
      status: "pass",
      critical: name !== "reliability_foundation",
    }),
  );
}

function baseContext() {
  return {
    organizationId: "org-1",
    environment: "test",
    commitHash: "abc123",
    deployId: "deploy-1",
    buildResult: "pass" as const,
    testResults: { passed: 100, failed: 0, total: 100 },
  };
}

test("all gates pass → GREEN", () => {
  const cert = evaluateReleaseCertificate(allPassGates(), baseContext(), "rc-green");
  assert.equal(cert.overallStatus, "GREEN");
  assert.equal(cert.failedGates.length, 0);
  assert.match(cert.releaseRecommendation, /Ready for production/i);
});

test("critical gate fail → RED", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "scanner_health" ? buildGateResult({ name: "scanner_health", status: "fail" }) : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-red-scanner");
  assert.equal(cert.overallStatus, "RED");
  assert.ok(cert.failedGates.includes("scanner_health"));
});

test("warning-only gate → YELLOW", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "reliability_foundation"
      ? buildGateResult({ name: "reliability_foundation", status: "warn", critical: false })
      : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-yellow");
  assert.equal(cert.overallStatus, "YELLOW");
  assert.ok(cert.warningGates.includes("reliability_foundation"));
});

test("failed integrity gate → RED", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "data_integrity_watch"
      ? buildGateResult({ name: "data_integrity_watch", status: "fail" })
      : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-red-integrity");
  assert.equal(cert.overallStatus, "RED");
});

test("failed RBAC gate → RED", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "rbac" ? buildGateResult({ name: "rbac", status: "fail" }) : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-red-rbac");
  assert.equal(cert.overallStatus, "RED");
});

test("failed configuration gate → RED", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "configuration_validation"
      ? buildGateResult({ name: "configuration_validation", status: "fail" })
      : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-red-config");
  assert.equal(cert.overallStatus, "RED");
});

test("failed dependency gate → RED", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "dependency_health"
      ? buildGateResult({ name: "dependency_health", status: "fail" })
      : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-red-deps");
  assert.equal(cert.overallStatus, "RED");
});

test("failed trust gate → RED", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "trust_architecture"
      ? buildGateResult({ name: "trust_architecture", status: "fail" })
      : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-red-trust");
  assert.equal(cert.overallStatus, "RED");
});

test("build fail → RED", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "build_status" ? buildGateResult({ name: "build_status", status: "fail" }) : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-red-build");
  assert.equal(cert.overallStatus, "RED");
});

test("missing unit test results → YELLOW via warn gate", () => {
  const gates = allPassGates().map((gate) =>
    gate.name === "unit_tests" ? buildGateResult({ name: "unit_tests", status: "warn" }) : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-yellow-tests");
  assert.equal(cert.overallStatus, "YELLOW");
});

test("deterministic scoring for same gate input", () => {
  const gates = allPassGates();
  const first = evaluateReleaseCertificate(gates, baseContext(), "rc-1");
  const second = evaluateReleaseCertificate(gates, baseContext(), "rc-2");
  assert.equal(first.overallScore, second.overallScore);
  assert.equal(first.overallStatus, second.overallStatus);
});

test("compareReleaseCertificates detects newly failed gates", () => {
  const baseline = evaluateReleaseCertificate(allPassGates(), baseContext(), "rc-base");
  const currentGates = allPassGates().map((gate) =>
    gate.name === "scanner_health" ? buildGateResult({ name: "scanner_health", status: "fail" }) : gate,
  );
  const current = evaluateReleaseCertificate(currentGates, baseContext(), "rc-current");
  const comparison = compareReleaseCertificates(baseline, current);
  assert.equal(comparison.statusChanged, true);
  assert.ok(comparison.newlyFailedGates.includes("scanner_health"));
});

test("GREEN emits INFO reliability event", () => {
  resetReleaseCertificateReliabilityDedupeForTests();
  const cert = evaluateReleaseCertificate(allPassGates(), baseContext(), "rc-info");
  const event = emitReleaseCertificateReliabilityEvent({ organizationId: "org-1", certificate: cert });
  assert.equal(event?.severity, "INFO");
});

test("YELLOW emits IMPORTANT reliability event", () => {
  resetReleaseCertificateReliabilityDedupeForTests();
  const gates = allPassGates().map((gate) =>
    gate.name === "audit_log" ? buildGateResult({ name: "audit_log", status: "warn" }) : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-important");
  const event = emitReleaseCertificateReliabilityEvent({ organizationId: "org-1", certificate: cert });
  assert.equal(event?.severity, "IMPORTANT");
});

test("RED blocked release emits CRITICAL reliability event", () => {
  resetReleaseCertificateReliabilityDedupeForTests();
  const gates = allPassGates().map((gate) =>
    gate.name === "dependency_health"
      ? buildGateResult({ name: "dependency_health", status: "fail" })
      : gate,
  );
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-critical");
  const event = emitReleaseCertificateReliabilityEvent({ organizationId: "org-1", certificate: cert });
  assert.equal(event?.severity, "CRITICAL");
});

test("certificate includes all required gate names", () => {
  const cert = evaluateReleaseCertificate(allPassGates(), baseContext(), "rc-gates");
  const names = cert.gateResults.map((g) => g.name);
  for (const required of RELEASE_GATE_NAMES) {
    assert.ok(names.includes(required), `missing gate ${required}`);
  }
});

test("low trust score blocks GREEN even without explicit fail", () => {
  const gates = allPassGates().map((gate) => ({
    ...gate,
    score: 50,
  }));
  const cert = evaluateReleaseCertificate(gates, baseContext(), "rc-low-trust");
  assert.ok(cert.trustScore < DEFAULT_RELEASE_CERTIFICATE_CONFIG.trustScoreMin);
  assert.equal(cert.overallStatus, "RED");
});
