import { recordPlatformAudit, systemAuditContext } from "../auditLog/index.js";
import type { ConfidenceResult } from "./confidenceTypes.js";

export function recordConfidenceDecisionAudit(input: {
  organizationId: string;
  entityType: string;
  entityId: string;
  result: ConfidenceResult;
  correlationId: string | null;
  sourceRoute: string | null;
  actorId: string | null;
}): void {
  recordPlatformAudit({
    ...systemAuditContext("confidenceGates", input.correlationId),
    actorType: input.actorId ? "user" : "system",
    actorId: input.actorId,
    organizationId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: "confidence_decided",
    severity: input.result.decision === "BLOCKED" ? "important" : "info",
    sourceRoute: input.sourceRoute,
    afterState: {
      decision: input.result.decision,
      confidenceScore: input.result.confidenceScore,
      confidenceLevel: input.result.confidenceLevel,
      blockingReasons: input.result.blockingReasons,
    },
    reason: input.result.explanation,
    metadata: {
      thresholds: input.result.thresholds,
      supportingEvidence: input.result.supportingEvidence.map((item) => ({
        source: item.source,
        score: item.score,
      })),
      missingEvidence: input.result.missingEvidence,
      recommendedAction: input.result.recommendedAction,
    },
  });
}
