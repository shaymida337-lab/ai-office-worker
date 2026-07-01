import type { AuditorConfig, AuditorFullReport } from "./auditorTypes.js";
import { comparePrimaryVsAuditor, evaluateAuditorDecision } from "./comparisonEngine.js";
import { combineConfidenceWithAuditor } from "./confidenceIntegration.js";
import { recordAuditorEvaluationAudit } from "./auditorAudit.js";
import { emitAuditorReliabilityEvent } from "./auditorReliability.js";

export function evaluateAuditorReport(
  input: Parameters<typeof evaluateAuditorDecision>[0],
  config: AuditorConfig,
): AuditorFullReport {
  const auditor = evaluateAuditorDecision(input, config);
  const comparison = comparePrimaryVsAuditor(input.primary, auditor, input, config);
  const confidenceGateHint = combineConfidenceWithAuditor(
    input.primary.confidenceScore,
    auditor.auditorConfidence,
    comparison,
    config,
  );

  const recommendation =
    auditor.auditorDecision === "FAIL"
      ? "Do not auto-execute. Resolve auditor conflicts first."
      : auditor.auditorDecision === "WARNING"
        ? "Proceed only after manual review."
        : "Safe to proceed through confidence gates when other checks pass.";

  return {
    primary: input.primary,
    auditor,
    comparison,
    recommendation,
    confidenceGateHint,
  };
}

export function evaluateAndRecordAuditorReport(
  input: Parameters<typeof evaluateAuditorDecision>[0],
  config: AuditorConfig,
  options?: { sourceRoute?: string | null; actorId?: string | null },
): AuditorFullReport {
  const report = evaluateAuditorReport(input, config);
  recordAuditorEvaluationAudit({
    organizationId: input.primary.organizationId,
    entityType: input.primary.entityType,
    entityId: input.primary.entityId,
    report,
    correlationId: input.primary.correlationId,
    sourceRoute: options?.sourceRoute ?? null,
    actorId: options?.actorId ?? null,
  });
  emitAuditorReliabilityEvent({
    organizationId: input.primary.organizationId,
    entityId: input.primary.entityId,
    entityType: input.primary.entityType,
    report,
    correlationId: input.primary.correlationId,
  });
  return report;
}
