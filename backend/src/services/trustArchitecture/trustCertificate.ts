import type { NatalieTrustCertificate, TrustCertificateDecision } from "./trustTypes.js";
import { TRUST_ARCHITECTURE_VERSION } from "./trustTypes.js";
import type { TrustScore } from "./trustTypes.js";

export type BuildTrustCertificateInput = {
  commitHash: string;
  deployId: string;
  reliabilityScore?: number | null;
  trustScore: TrustScore;
  goldenResult: NatalieTrustCertificate["goldenResult"];
  journeyResult: NatalieTrustCertificate["journeyResult"];
  integrityResult: NatalieTrustCertificate["integrityResult"];
  permissionsResult: NatalieTrustCertificate["permissionsResult"];
  securityResult: NatalieTrustCertificate["securityResult"];
  auditResult: NatalieTrustCertificate["auditResult"];
  recoveryResult: NatalieTrustCertificate["recoveryResult"];
  dependenciesResult: NatalieTrustCertificate["dependenciesResult"];
  configurationResult: NatalieTrustCertificate["configurationResult"];
  businessRulesResult: NatalieTrustCertificate["businessRulesResult"];
  approvedBy?: string | null;
  generatedAt?: string;
};

type ResultField = NatalieTrustCertificate["goldenResult"];

export function buildNatalieTrustCertificate(input: BuildTrustCertificateInput): NatalieTrustCertificate {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.trustScore.criticalFailures > 0) {
    blockers.push(`${input.trustScore.criticalFailures} critical trust score failures`);
  }
  if (input.trustScore.score < 90) {
    blockers.push(`trust score ${input.trustScore.score} below 90 threshold`);
  }

  addResultBlocker(blockers, warnings, "golden", input.goldenResult);
  addResultBlocker(blockers, warnings, "journey", input.journeyResult);
  addResultBlocker(blockers, warnings, "integrity", input.integrityResult);
  addResultBlocker(blockers, warnings, "permissions", input.permissionsResult);
  addResultBlocker(blockers, warnings, "security", input.securityResult);
  addResultBlocker(blockers, warnings, "audit", input.auditResult);
  addResultBlocker(blockers, warnings, "business_rules", input.businessRulesResult);

  if (input.dependenciesResult === "fail") blockers.push("dependency health failed");
  if (input.configurationResult === "fail") blockers.push("configuration validation failed");
  if (input.recoveryResult === "fail") warnings.push("recovery readiness degraded");

  if (input.dependenciesResult === "warn") warnings.push("dependency health degraded");
  if (input.configurationResult === "warn") warnings.push("configuration warnings");

  const releaseDecision: TrustCertificateDecision = blockers.length > 0 ? "blocked" : "approved";

  return {
    schemaVersion: TRUST_ARCHITECTURE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    commitHash: input.commitHash,
    deployId: input.deployId,
    reliabilityScore: input.reliabilityScore ?? null,
    trustScore: input.trustScore.score,
    goldenResult: input.goldenResult,
    journeyResult: input.journeyResult,
    integrityResult: input.integrityResult,
    permissionsResult: input.permissionsResult,
    securityResult: input.securityResult,
    auditResult: input.auditResult,
    recoveryResult: input.recoveryResult,
    dependenciesResult: input.dependenciesResult,
    configurationResult: input.configurationResult,
    businessRulesResult: input.businessRulesResult,
    approvedBy: input.approvedBy ?? null,
    releaseDecision,
    blockers,
    warnings,
  };
}

function addResultBlocker(
  blockers: string[],
  warnings: string[],
  label: string,
  result: ResultField,
): void {
  if (result === "fail") blockers.push(`${label} checks failed`);
  if (result === "warn") warnings.push(`${label} checks have warnings`);
  if (result === "not_run") blockers.push(`${label} checks not run`);
}

export function formatTrustCertificate(cert: NatalieTrustCertificate): string {
  const lines = [
    `Natalie Trust Certificate (${cert.schemaVersion})`,
    `Decision: ${cert.releaseDecision.toUpperCase()}`,
    `Trust Score: ${cert.trustScore}`,
    `Reliability Score: ${cert.reliabilityScore ?? "n/a"}`,
    `Commit: ${cert.commitHash} | Deploy: ${cert.deployId}`,
    `Golden: ${cert.goldenResult} | Journey: ${cert.journeyResult} | Integrity: ${cert.integrityResult}`,
    `Permissions: ${cert.permissionsResult} | Security: ${cert.securityResult} | Business Rules: ${cert.businessRulesResult}`,
    `Approved by: ${cert.approvedBy ?? "pending"}`,
    `Timestamp: ${cert.generatedAt}`,
  ];
  if (cert.blockers.length > 0) lines.push(`Blockers: ${cert.blockers.join("; ")}`);
  if (cert.warnings.length > 0) lines.push(`Warnings: ${cert.warnings.join("; ")}`);
  return lines.join("\n");
}

export function isTrustCertificateApproved(cert: NatalieTrustCertificate): boolean {
  return cert.releaseDecision === "approved";
}
