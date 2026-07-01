/**
 * Phase 2.8 — Release Certificate production types.
 */

export const RELEASE_CERTIFICATE_STATUSES = ["GREEN", "YELLOW", "RED"] as const;
export type ReleaseCertificateStatus = (typeof RELEASE_CERTIFICATE_STATUSES)[number];

export const RELEASE_GATE_STATUSES = ["pass", "warn", "fail", "not_run"] as const;
export type ReleaseGateStatus = (typeof RELEASE_GATE_STATUSES)[number];

export const RELEASE_GATE_NAMES = [
  "build_status",
  "unit_tests",
  "scanner_health",
  "data_integrity_watch",
  "audit_log",
  "rbac",
  "confidence_gates",
  "ai_auditor",
  "reliability_foundation",
  "trust_architecture",
  "golden_test_suite",
  "customer_journey_tests",
  "business_rules",
  "configuration_validation",
  "dependency_health",
] as const;

export type ReleaseGateName = (typeof RELEASE_GATE_NAMES)[number];

export type ReleaseGateResult = {
  name: ReleaseGateName;
  status: ReleaseGateStatus;
  score: number;
  critical: boolean;
  evidence: Record<string, unknown>;
  blockingReason: string | null;
};

export type ReleaseCertificate = {
  certificateId: string;
  timestamp: string;
  commitHash: string | null;
  deployId: string | null;
  environment: string;
  overallStatus: ReleaseCertificateStatus;
  overallScore: number;
  gateResults: ReleaseGateResult[];
  failedGates: ReleaseGateName[];
  warningGates: ReleaseGateName[];
  releaseRecommendation: string;
  explanation: string;
  trustScore: number;
};

export type ReleaseCertificateHistoryItem = Pick<
  ReleaseCertificate,
  | "certificateId"
  | "timestamp"
  | "commitHash"
  | "deployId"
  | "environment"
  | "overallStatus"
  | "overallScore"
  | "failedGates"
  | "warningGates"
  | "releaseRecommendation"
>;

export type ReleaseCertificateComparison = {
  baselineCertificateId: string;
  currentCertificateId: string;
  statusChanged: boolean;
  scoreDelta: number;
  newlyFailedGates: ReleaseGateName[];
  newlyWarningGates: ReleaseGateName[];
  resolvedGates: ReleaseGateName[];
  explanation: string;
};

export type ReleaseCertificateGenerateContext = {
  organizationId: string;
  environment?: string;
  commitHash?: string | null;
  deployId?: string | null;
  buildResult?: "pass" | "fail";
  testResults?: { passed: number; failed: number; total: number };
};
