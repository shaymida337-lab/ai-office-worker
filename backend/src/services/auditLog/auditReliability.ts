import { buildReliabilityEvent } from "../reliability/reliabilityEventModel.js";
import type { ReliabilityEvent } from "../reliability/reliabilityTypes.js";
import {
  FINANCIAL_AUDIT_ACTIONS,
  SECURITY_AUDIT_ACTIONS,
  type PlatformAuditRecord,
} from "./auditTypes.js";

const emittedCorrelationIds = new Set<string>();

/**
 * Optional in-process reliability signal for important financial/security audit actions.
 * Not persisted — complements the immutable audit trail.
 */
export function maybeEmitAuditReliabilityEvent(record: PlatformAuditRecord): ReliabilityEvent | null {
  if (!FINANCIAL_AUDIT_ACTIONS.has(record.action) && !SECURITY_AUDIT_ACTIONS.has(record.action)) {
    return null;
  }

  const dedupeKey = `${record.auditId}:${record.action}`;
  if (emittedCorrelationIds.has(dedupeKey)) return null;
  emittedCorrelationIds.add(dedupeKey);

  const subsystem = FINANCIAL_AUDIT_ACTIONS.has(record.action) ? "payments" : "gmail";
  const severity =
    record.severity === "critical" ? "CRITICAL" : record.severity === "important" ? "IMPORTANT" : "INFO";

  return buildReliabilityEvent({
    subsystem,
    stage: "audit_log",
    severity,
    organizationId: record.organizationId,
    entityId: record.entityId,
    correlationId: record.correlationId ?? record.auditId,
    probableRootCause: record.action,
    suggestedAction: "Review immutable audit trail entry",
    autoRecoverable: false,
    message: `${record.action} on ${record.entityType}:${record.entityId}`,
  });
}

/** Test helper — reset in-process dedupe cache. */
export function resetAuditReliabilityDedupeForTests(): void {
  emittedCorrelationIds.clear();
}
