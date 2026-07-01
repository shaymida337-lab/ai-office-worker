import { recordPlatformAudit, systemAuditContext } from "../auditLog/index.js";
import type { AuditorFullReport } from "./auditorTypes.js";

export function recordAuditorEvaluationAudit(input: {
  organizationId: string;
  entityType: string;
  entityId: string;
  report: AuditorFullReport;
  correlationId: string | null;
  sourceRoute: string | null;
  actorId: string | null;
}): void {
  recordPlatformAudit({
    ...systemAuditContext("aiAuditor", input.correlationId),
    actorType: input.actorId ? "user" : "AI",
    actorId: input.actorId ?? "natalie-auditor",
    organizationId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: "ai_auditor_evaluated",
    severity: input.report.auditor.auditorDecision === "FAIL" ? "important" : "info",
    sourceRoute: input.sourceRoute,
    afterState: {
      auditorDecision: input.report.auditor.auditorDecision,
      auditorConfidence: input.report.auditor.auditorConfidence,
      agrees: input.report.comparison.agrees,
    },
    reason: input.report.auditor.explanation,
    metadata: {
      differences: input.report.comparison.differences,
      findings: input.report.auditor.findings,
      recommendation: input.report.recommendation,
      confidenceGateHint: input.report.confidenceGateHint,
    },
  });
}
