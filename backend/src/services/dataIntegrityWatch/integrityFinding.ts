import type { IntegrityCheckCategory, IntegrityFinding, IntegrityFindingStatus, IntegritySeverity } from "./integrityTypes.js";

export function buildIntegrityFinding(input: {
  checkId: string;
  category: IntegrityCheckCategory;
  severity: IntegritySeverity;
  organizationId: string;
  entityType: string;
  entityId?: string | null;
  status?: IntegrityFindingStatus;
  explanation: string;
  probableRootCause?: string | null;
  suggestedAction?: string | null;
  correlationId?: string | null;
  detectedAt?: string;
}): IntegrityFinding {
  return {
    checkId: input.checkId,
    category: input.category,
    severity: input.severity,
    organizationId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    status: input.status ?? "fail",
    explanation: input.explanation,
    probableRootCause: input.probableRootCause ?? null,
    suggestedAction: input.suggestedAction ?? null,
    autoRecoverable: false,
    correlationId: input.correlationId ?? null,
    detectedAt: input.detectedAt ?? new Date().toISOString(),
  };
}

export function filterFailedFindings(findings: IntegrityFinding[]): IntegrityFinding[] {
  return findings.filter((f) => f.status === "fail");
}
