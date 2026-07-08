export const RELIABILITY_CENTER_SEVERITIES = [
  "info",
  "warning",
  "error",
  "critical",
] as const;

export type ReliabilityCenterSeverity = (typeof RELIABILITY_CENTER_SEVERITIES)[number];

export const RELIABILITY_CENTER_STATUSES = ["open", "resolved"] as const;
export type ReliabilityCenterStatus = (typeof RELIABILITY_CENTER_STATUSES)[number];

/** Modules monitored by Reliability Center V1. */
export const RELIABILITY_CENTER_MODULES = [
  "dashboard",
  "gmail_scan",
  "invoice_pipeline",
  "document_review",
  "whatsapp",
  "calendar",
  "business_memory",
  "google_drive",
  "voice_stt",
  "oauth",
  "background_jobs",
  "platform",
] as const;

export type ReliabilityCenterModule = (typeof RELIABILITY_CENTER_MODULES)[number];

export type RecordReliabilityEventInput = {
  organizationId?: string | null;
  userId?: string | null;
  module: ReliabilityCenterModule | string;
  severity: ReliabilityCenterSeverity;
  errorCode: string;
  userVisibleMessage?: string | null;
  technicalMessage?: string | null;
  route?: string | null;
  component?: string | null;
  job?: string | null;
  correlationId?: string | null;
  customerVisible?: boolean;
  autoHealed?: boolean;
  metadata?: Record<string, unknown> | null;
  /** Optional override; default fingerprint groups by org+module+errorCode+route/job. */
  fingerprint?: string | null;
  now?: Date;
};

export type ReliabilityEventRecord = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  module: string;
  severity: ReliabilityCenterSeverity;
  errorCode: string;
  userVisibleMessage: string | null;
  technicalMessage: string | null;
  route: string | null;
  component: string | null;
  job: string | null;
  correlationId: string | null;
  status: ReliabilityCenterStatus;
  fingerprint: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  occurrences: number;
  autoHealed: boolean;
  customerVisible: boolean;
  metadata: unknown;
};

export type ReliabilityAlertAggregate = {
  key: string;
  module: string;
  errorCode: string;
  severity: ReliabilityCenterSeverity;
  occurrences: number;
  organizationCount: number;
  customerVisible: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  summary: string;
};

export type ReliabilityHealthReport = {
  generatedAt: string;
  organizationId: string | null;
  overallHealthScore: number;
  overallStatus: "healthy" | "degraded" | "unhealthy";
  openCriticalIssues: number;
  customerVisibleIssues: number;
  stuckJobs: number;
  scanHealth: "healthy" | "degraded" | "unhealthy";
  whatsappHealth: "healthy" | "degraded" | "unhealthy";
  invoiceApprovalHealth: "healthy" | "degraded" | "unhealthy";
  oauthHealth: "healthy" | "degraded" | "unhealthy";
  last24hErrorCounts: {
    total: number;
    critical: number;
    error: number;
    warning: number;
    info: number;
  };
  autoHealedIssues: number;
  unresolvedIssues: number;
  openEvents: Array<{
    id: string;
    module: string;
    severity: ReliabilityCenterSeverity;
    errorCode: string;
    userVisibleMessage: string | null;
    occurrences: number;
    customerVisible: boolean;
    lastSeenAt: string;
  }>;
  aggregates: ReliabilityAlertAggregate[];
  hebrewSummary: string;
};
