/**
 * Phase 2.4 — Platform Audit Log types (immutable, append-only).
 */

export const PLATFORM_AUDIT_ACTOR_TYPES = ["user", "AI", "system"] as const;
export type PlatformAuditActorType = (typeof PLATFORM_AUDIT_ACTOR_TYPES)[number];

export const PLATFORM_AUDIT_SEVERITIES = ["info", "important", "critical"] as const;
export type PlatformAuditSeverity = (typeof PLATFORM_AUDIT_SEVERITIES)[number];

export const PLATFORM_AUDIT_ACTIONS = [
  "payment_created",
  "payment_updated",
  "payment_deleted",
  "invoice_created",
  "invoice_updated",
  "invoice_deleted",
  "document_approved",
  "document_rejected",
  "review_reassigned",
  "review_overridden",
  "integration_connected",
  "integration_disconnected",
  "user_login",
  "organization_created",
  "user_invited",
  "permissions_changed",
  "permission_denied",
  "confidence_decided",
  "ai_auditor_evaluated",
  "release_certificate_generated",
  "release_blocked",
  "google_sync_started",
  "google_sync_succeeded",
  "google_sync_failed",
  "google_sync_retry_scheduled",
  "google_sync_retry_started",
  "google_sync_retry_succeeded",
  "google_sync_retry_failed",
  "google_sync_dead_letter",
  "appointment_created",
  "appointment_updated",
  "appointment_cancelled",
  "appointment_rescheduled",
  "appointment_delete_requested",
  "appointment_delete_completed",
  "natalie_calendar_intent_detected",
  "natalie_appointment_create_requested",
  "natalie_appointment_created",
  "natalie_appointment_cancel_requested",
  "natalie_appointment_cancelled",
  "natalie_appointment_reschedule_requested",
  "natalie_appointment_rescheduled",
  "natalie_calendar_action_failed",
  "calendar_decision_created",
  "calendar_decision_approved",
  "calendar_decision_rejected",
  "calendar_decision_expired",
  "calendar_decision_execution_failed",
  "calendar_permission_denied",
  "calendar_cross_org_attempt",
  "calendar_idempotency_replay",
  "calendar_idempotency_conflict",
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

export type PlatformAuditActorContext = {
  actorType: PlatformAuditActorType;
  actorId: string | null;
  sourceModule: string;
  sourceRoute?: string | null;
  correlationId?: string | null;
};

export type AppendPlatformAuditInput = PlatformAuditActorContext & {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: PlatformAuditAction;
  severity?: PlatformAuditSeverity;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: Date;
};

export type PlatformAuditRecord = {
  auditId: string;
  timestamp: string;
  organizationId: string;
  correlationId: string | null;
  actorType: PlatformAuditActorType;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: PlatformAuditAction;
  severity: PlatformAuditSeverity;
  sourceModule: string;
  sourceRoute: string | null;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  metadata: Record<string, unknown> | null;
};

export type PlatformAuditListFilters = {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: PlatformAuditAction | string;
  correlationId?: string;
  severity?: PlatformAuditSeverity | string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
};

export type PlatformAuditListResult = {
  items: PlatformAuditRecord[];
  nextCursor: string | null;
  totalInPage: number;
};

export const FINANCIAL_AUDIT_ACTIONS = new Set<PlatformAuditAction>([
  "payment_created",
  "payment_updated",
  "payment_deleted",
  "invoice_created",
  "invoice_updated",
  "invoice_deleted",
  "document_approved",
  "document_rejected",
  "review_overridden",
]);

export const SECURITY_AUDIT_ACTIONS = new Set<PlatformAuditAction>([
  "user_login",
  "organization_created",
  "user_invited",
  "permissions_changed",
  "permission_denied",
  "integration_connected",
  "integration_disconnected",
]);

export function defaultSeverityForAction(action: PlatformAuditAction): PlatformAuditSeverity {
  if (
    action === "payment_deleted" ||
    action === "document_rejected" ||
    action === "permissions_changed" ||
    action === "permission_denied" ||
    action === "calendar_permission_denied" ||
    action === "calendar_cross_org_attempt" ||
    action === "calendar_idempotency_conflict" ||
    action === "review_overridden" ||
    action === "google_sync_failed" ||
    action === "google_sync_retry_failed" ||
    action === "natalie_calendar_action_failed" ||
    action === "calendar_decision_execution_failed"
  ) {
    return "important";
  }
  if (
    action === "payment_created" ||
    action === "document_approved" ||
    action === "invoice_created" ||
    action === "google_sync_dead_letter" ||
    action === "appointment_delete_requested"
  ) {
    return "important";
  }
  return "info";
}

export function correlationIdFromGmailMessage(gmailMessageId?: string | null): string | null {
  if (!gmailMessageId?.trim()) return null;
  return `gmail:${gmailMessageId.trim()}`;
}

export function correlationIdFromEmailMessage(emailMessageId?: string | null): string | null {
  if (!emailMessageId?.trim()) return null;
  return `email:${emailMessageId.trim()}`;
}

export function resolveWorkflowCorrelationId(input: {
  gmailMessageId?: string | null;
  emailMessageId?: string | null;
  explicit?: string | null;
}): string | null {
  return (
    input.explicit?.trim() ||
    correlationIdFromGmailMessage(input.gmailMessageId) ||
    correlationIdFromEmailMessage(input.emailMessageId) ||
    null
  );
}
