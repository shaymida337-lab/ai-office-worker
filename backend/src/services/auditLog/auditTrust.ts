import type { PlatformAuditRecord } from "./auditTypes.js";

export type AuditTrustContribution = {
  auditEvidenceCount: number;
  financialAuditCount: number;
  securityAuditCount: number;
  latestAuditAt: string | null;
  hasImmutableTrail: true;
};

export function buildAuditTrustContribution(records: PlatformAuditRecord[]): AuditTrustContribution {
  const financial = records.filter((r) =>
    r.action.startsWith("payment_") ||
    r.action.startsWith("invoice_") ||
    r.action.startsWith("document_") ||
    r.action.startsWith("review_"),
  ).length;
  const security = records.filter((r) =>
    ["user_login", "organization_created", "permissions_changed", "integration_connected", "integration_disconnected"].includes(
      r.action,
    ),
  ).length;

  return {
    auditEvidenceCount: records.length,
    financialAuditCount: financial,
    securityAuditCount: security,
    latestAuditAt: records[0]?.timestamp ?? null,
    hasImmutableTrail: true,
  };
}

export function auditRecordForDecisionEvidence(record: PlatformAuditRecord) {
  return {
    auditId: record.auditId,
    action: record.action,
    actorType: record.actorType,
    actorId: record.actorId,
    timestamp: record.timestamp,
    correlationId: record.correlationId,
    beforeState: record.beforeState,
    afterState: record.afterState,
    reason: record.reason,
  };
}
