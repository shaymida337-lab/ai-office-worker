/** Natalie Core Reliability Platform — Phase 1 shared contracts. */

export const NATALIE_CORE_HEALTH_STATUSES = [
  "Healthy",
  "Degraded",
  "Recovering",
  "Failed",
  "Unknown",
] as const;

export type NatalieCoreHealthStatus = (typeof NATALIE_CORE_HEALTH_STATUSES)[number];

export const NATALIE_CORE_ERROR_CATEGORIES = [
  "network",
  "auth",
  "validation",
  "timeout",
  "external_service",
  "rate_limit",
  "internal",
  "unknown",
] as const;

export type NatalieCoreErrorCategory = (typeof NATALIE_CORE_ERROR_CATEGORIES)[number];

export const NATALIE_CORE_ERROR_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type NatalieCoreErrorSeverity = (typeof NATALIE_CORE_ERROR_SEVERITIES)[number];

export const NATALIE_CORE_AUDIT_EVENT_TYPES = [
  "started",
  "completed",
  "skipped",
  "recovered",
  "failed",
  "retried",
] as const;

export type NatalieCoreAuditEventType = (typeof NATALIE_CORE_AUDIT_EVENT_TYPES)[number];

export type NatalieCoreHealthSnapshot = {
  subsystemId: string;
  status: NatalieCoreHealthStatus;
  checkedAt: string;
  message?: string | null;
};

export type NatalieCoreClassifiedError = {
  category: NatalieCoreErrorCategory;
  severity: NatalieCoreErrorSeverity;
  recoverable: boolean;
  userVisible: boolean;
  recommendedAction: string;
  message: string;
  code?: string | null;
};

export type NatalieCoreAuditEvent = {
  type: NatalieCoreAuditEventType;
  subsystem: string;
  stage: string;
  correlationId: string | null;
  organizationId: string | null;
  entityId: string | null;
  timestamp: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type NatalieCoreCorrelationContext = {
  correlationId: string;
  parentCorrelationId?: string | null;
  workflow?: string | null;
};

export type NatalieCoreInvariantResult<T = unknown> = {
  ok: boolean;
  violation?: string;
  recovered: boolean;
  value: T;
};

export type NatalieCoreRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
};

export type NatalieCoreDiagnosticEvent = {
  at: number;
  subsystem: string;
  kind: string;
  message: string;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
};
