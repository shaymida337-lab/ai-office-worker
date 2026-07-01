export type ReleaseCertificateConfig = {
  trustScoreMin: number;
  enabled: boolean;
};

export const DEFAULT_RELEASE_CERTIFICATE_CONFIG: ReleaseCertificateConfig = {
  trustScoreMin: 90,
  enabled: true,
};

export const CRITICAL_RELEASE_GATES = new Set([
  "build_status",
  "unit_tests",
  "scanner_health",
  "data_integrity_watch",
  "audit_log",
  "rbac",
  "confidence_gates",
  "ai_auditor",
  "trust_architecture",
  "golden_test_suite",
  "customer_journey_tests",
  "business_rules",
  "configuration_validation",
  "dependency_health",
] as const);

export const GATE_WEIGHTS: Record<string, number> = {
  build_status: 10,
  unit_tests: 10,
  scanner_health: 8,
  data_integrity_watch: 10,
  audit_log: 6,
  rbac: 8,
  confidence_gates: 6,
  ai_auditor: 6,
  reliability_foundation: 4,
  trust_architecture: 8,
  golden_test_suite: 10,
  customer_journey_tests: 10,
  business_rules: 8,
  configuration_validation: 6,
  dependency_health: 8,
};
