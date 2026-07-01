import type { ReleaseCertificate, ReleaseDecision } from "./hardeningTypes.js";
import { HARDENING_PLAN_VERSION } from "./hardeningTypes.js";

export type ReleaseCertificateInput = {
  commitHash: string;
  deployId: string;
  buildResult: "pass" | "fail";
  testResults: { passed: number; failed: number; total: number };
  goldenSuiteResult: ReleaseCertificate["goldenSuiteResult"];
  journeyResult: ReleaseCertificate["journeyResult"];
  dataIntegrityResult: ReleaseCertificate["dataIntegrityResult"];
  securityIsolationResult: ReleaseCertificate["securityIsolationResult"];
  dependencyHealth: ReleaseCertificate["dependencyHealth"];
  rollbackReadiness: ReleaseCertificate["rollbackReadiness"];
  reliabilityScore?: number | null;
  generatedAt?: string;
};

const CRITICAL_CHECK_KEYS = [
  "buildResult",
  "goldenSuiteResult",
  "journeyResult",
  "dataIntegrityResult",
  "securityIsolationResult",
] as const;

/**
 * Aggregates all pre-launch reliability checks into a release certificate.
 * Critical failures block release.
 */
export function buildReleaseCertificate(input: ReleaseCertificateInput): ReleaseCertificate {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.buildResult === "fail") blockers.push("build failed");
  if (input.testResults.failed > 0) blockers.push(`${input.testResults.failed} unit tests failed`);
  if (input.goldenSuiteResult === "fail") blockers.push("golden suite failed");
  if (input.journeyResult === "fail") blockers.push("journey tests failed");
  if (input.dataIntegrityResult === "fail") blockers.push("data integrity watch failed");
  if (input.securityIsolationResult === "fail") blockers.push("security/isolation checks failed");
  if (input.dependencyHealth === "fail") blockers.push("dependency health failed");
  if (input.rollbackReadiness === "not_ready") blockers.push("rollback not ready");

  if (input.goldenSuiteResult === "warn") warnings.push("golden suite warnings");
  if (input.journeyResult === "warn") warnings.push("journey test warnings");
  if (input.dataIntegrityResult === "warn") warnings.push("data integrity warnings");
  if (input.dependencyHealth === "warn") warnings.push("dependency health degraded");

  const releaseDecision: ReleaseDecision = blockers.length > 0 ? "blocked" : "approved";

  return {
    schemaVersion: HARDENING_PLAN_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    commitHash: input.commitHash,
    deployId: input.deployId,
    buildResult: input.buildResult,
    testResults: input.testResults,
    goldenSuiteResult: input.goldenSuiteResult,
    journeyResult: input.journeyResult,
    dataIntegrityResult: input.dataIntegrityResult,
    securityIsolationResult: input.securityIsolationResult,
    dependencyHealth: input.dependencyHealth,
    rollbackReadiness: input.rollbackReadiness,
    reliabilityScore: input.reliabilityScore ?? null,
    releaseDecision,
    blockers,
    warnings,
  };
}

export function formatReleaseCertificate(cert: ReleaseCertificate): string {
  const lines = [
    `Release Certificate (${cert.schemaVersion})`,
    `Decision: ${cert.releaseDecision.toUpperCase()}`,
    `Commit: ${cert.commitHash}`,
    `Deploy: ${cert.deployId}`,
    `Build: ${cert.buildResult}`,
    `Tests: ${cert.testResults.passed}/${cert.testResults.total}`,
    `Golden: ${cert.goldenSuiteResult} | Journey: ${cert.journeyResult}`,
    `Integrity: ${cert.dataIntegrityResult} | Isolation: ${cert.securityIsolationResult}`,
    `Dependencies: ${cert.dependencyHealth} | Rollback: ${cert.rollbackReadiness}`,
    `Reliability score: ${cert.reliabilityScore ?? "n/a"}`,
  ];
  if (cert.blockers.length > 0) lines.push(`Blockers: ${cert.blockers.join("; ")}`);
  if (cert.warnings.length > 0) lines.push(`Warnings: ${cert.warnings.join("; ")}`);
  return lines.join("\n");
}

export function isReleaseBlocked(cert: ReleaseCertificate): boolean {
  return cert.releaseDecision === "blocked";
}

export function listCriticalReleaseChecks(): readonly string[] {
  return CRITICAL_CHECK_KEYS;
}
