import { buildReliabilityEvent } from "../reliability/reliabilityEventModel.js";
import type { ReliabilityEvent } from "../reliability/reliabilityTypes.js";
import type { AuditorFullReport } from "./auditorTypes.js";

const emittedKeys = new Set<string>();

export function emitAuditorReliabilityEvent(input: {
  organizationId: string;
  entityType: string;
  entityId: string;
  report: AuditorFullReport;
  correlationId: string | null;
}): ReliabilityEvent | null {
  if (input.report.auditor.auditorDecision === "PASS" && input.report.comparison.differences.length === 0) {
    return null;
  }

  const dedupeKey = `${input.organizationId}:${input.entityType}:${input.entityId}:${input.report.auditor.auditorDecision}`;
  if (emittedKeys.has(dedupeKey)) return null;
  emittedKeys.add(dedupeKey);

  const severity =
    input.report.auditor.auditorDecision === "FAIL" &&
    input.report.comparison.differences.some((d) =>
      ["amount", "duplicate", "classification", "organization"].includes(d.field),
    )
      ? "CRITICAL"
      : "IMPORTANT";

  return buildReliabilityEvent({
    subsystem: "payments",
    stage: "ai_auditor",
    severity,
    organizationId: input.organizationId,
    entityId: input.entityId,
    correlationId: input.correlationId ?? dedupeKey,
    probableRootCause: input.report.comparison.differences[0]?.field ?? "auditor_disagreement",
    suggestedAction: input.report.recommendation,
    autoRecoverable: input.report.auditor.auditorDecision === "WARNING",
    message: input.report.comparison.explanation,
  });
}

export function resetAuditorReliabilityDedupeForTests(): void {
  emittedKeys.clear();
}
