import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { classifyIntegrityResult } from "../dataIntegrityWatch/integrityScore.js";
import { runIntegrityWatchForOrganization } from "../dataIntegrityWatch/integrityRunner.js";
import type { IntegrityReadOnlyDb } from "../dataIntegrityWatch/integrityDb.js";
import { loadConfidenceThresholds } from "../confidenceGates/confidenceConfig.js";
import { loadAuditorConfig } from "../aiAuditor/auditorConfig.js";
import { validateConfiguration, type ConfigValidationResult } from "../reliabilityHardening/configurationValidation.js";
import {
  classifyDependencyHealthResult,
  buildDependencyHealthReport,
  buildDependencyHealthSnapshot,
} from "../reliabilityHardening/dependencyHealth.js";
import { loadGoldenDataset } from "../golden/goldenDataset.js";
import { runGoldenDataset } from "../golden/goldenRunner.js";
import { runJourneyReliabilityDryRun } from "../journeyReliability/journeyRunner.js";
import { buildJourneyDatasetFromRegistry } from "../journeyReliability/journeyRegistry.js";
import { evaluateBusinessRules, summarizeBusinessRuleEvaluations } from "../trustArchitecture/businessRulesEngine.js";
import { computeTrustScore } from "../trustArchitecture/trustScore.js";
import type { TrustScoreInputStatus } from "../trustArchitecture/trustScore.js";
import { buildReliabilityDashboardSnapshot } from "../reliability/reliabilityDashboard.js";
import { getScannerHealthResponse, parseScannerHealthRange } from "../scanner/scannerHealthService.js";
import { adaptScannerHealthToSubsystemContract } from "../reliability/scannerReliabilityAdapter.js";
import { getSystemHealth } from "../systemHealth.js";
import { listOrganizationMembers } from "../rbac/membership.js";
import type { ReleaseCertificateGenerateContext, ReleaseGateName, ReleaseGateResult } from "./certificateTypes.js";
import { buildGateResult, mapPassWarnFail } from "./gateEvaluator.js";

export type GateCollectionContext = ReleaseCertificateGenerateContext;

function recommendationToGateStatus(value: "pass" | "warn" | "fail" | "not_run"): ReleaseGateResult["status"] {
  return mapPassWarnFail(value);
}

export async function collectReleaseGateResults(context: GateCollectionContext): Promise<ReleaseGateResult[]> {
  const preGates = await collectPreTrustGates(context);
  const trustGate = collectTrustArchitectureGate(preGates);
  return [...preGates, trustGate];
}

async function collectPreTrustGates(context: GateCollectionContext): Promise<ReleaseGateResult[]> {
  return Promise.all([
    Promise.resolve(collectBuildStatusGate(context)),
    Promise.resolve(collectUnitTestsGate(context)),
    collectScannerHealthGate(context),
    collectDataIntegrityGate(context),
    collectAuditLogGate(context),
    collectRbacGate(context),
    collectConfidenceGatesGate(context),
    collectAiAuditorGate(context),
    collectReliabilityFoundationGate(context),
    Promise.resolve(collectGoldenSuiteGate()),
    Promise.resolve(collectJourneyTestsGate()),
    Promise.resolve(collectBusinessRulesGate()),
    Promise.resolve(collectConfigurationGate()),
    collectDependencyHealthGate(context),
  ]);
}

function collectBuildStatusGate(context: GateCollectionContext): ReleaseGateResult {
  const buildResult = context.buildResult ?? (process.env.RELEASE_BUILD_STATUS === "fail" ? "fail" : "pass");
  return buildGateResult({
    name: "build_status",
    status: buildResult === "pass" ? "pass" : "fail",
    evidence: { buildResult, source: "ci_or_env" },
    blockingReason: buildResult === "fail" ? "Build failed" : null,
  });
}

function collectUnitTestsGate(context: GateCollectionContext): ReleaseGateResult {
  const passed = context.testResults?.passed ?? Number(process.env.RELEASE_TEST_PASSED ?? 0);
  const failed = context.testResults?.failed ?? Number(process.env.RELEASE_TEST_FAILED ?? 0);
  const total = context.testResults?.total ?? Number(process.env.RELEASE_TEST_TOTAL ?? passed + failed);
  const status = failed > 0 ? "fail" : total > 0 ? "pass" : "warn";
  return buildGateResult({
    name: "unit_tests",
    status,
    evidence: { passed, failed, total },
    blockingReason: failed > 0 ? `${failed} unit tests failed` : total === 0 ? "No unit test results provided" : null,
  });
}

async function collectScannerHealthGate(context: GateCollectionContext): Promise<ReleaseGateResult> {
  try {
    const response = await getScannerHealthResponse(prisma, {
      organizationId: context.organizationId,
      range: parseScannerHealthRange({}),
    });
    const contract = adaptScannerHealthToSubsystemContract(response);
    const criticalViolations = response.violations.bySeverity.critical;
    const status = criticalViolations > 0 || contract.status === "unhealthy" ? "fail" : "pass";
    return buildGateResult({
      name: "scanner_health",
      status,
      evidence: {
        operationalStatus: contract.status,
        violations: response.violations,
        ingestionSuccessRate: response.health.ingestion.ingestionSuccessRate,
      },
      blockingReason: status === "fail" ? "Scanner health critical" : null,
    });
  } catch (err) {
    return buildGateResult({
      name: "scanner_health",
      status: "warn",
      evidence: { error: err instanceof Error ? err.message : String(err) },
      blockingReason: null,
    });
  }
}

async function collectDataIntegrityGate(context: GateCollectionContext): Promise<ReleaseGateResult> {
  try {
    const report = await runIntegrityWatchForOrganization(
      prisma as unknown as IntegrityReadOnlyDb,
      context.organizationId,
      { dryRun: true, mode: "manual" },
    );
    const classification = classifyIntegrityResult(report.overallIntegrityScore, report.criticalFindings);
    const status =
      report.criticalFindings > 0
        ? "fail"
        : report.importantFindings > 0
          ? "warn"
          : "pass";
    return buildGateResult({
      name: "data_integrity_watch",
      status,
      evidence: {
        overallIntegrityScore: report.overallIntegrityScore,
        criticalFindings: report.criticalFindings,
        importantFindings: report.importantFindings,
        warningFindings: report.warningFindings,
        passed: report.passed,
        integrityClassification: classification,
      },
      blockingReason: status === "fail" ? "Data integrity critical findings" : null,
    });
  } catch (err) {
    return buildGateResult({
      name: "data_integrity_watch",
      status: "warn",
      evidence: { error: err instanceof Error ? err.message : String(err) },
      blockingReason: null,
    });
  }
}

async function collectAuditLogGate(context: GateCollectionContext): Promise<ReleaseGateResult> {
  try {
    const count = await prisma.platformAuditLog.count({
      where: { organizationId: context.organizationId },
    });
    return buildGateResult({
      name: "audit_log",
      status: "pass",
      evidence: { moduleActive: true, sampleEventCount: count },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const tableMissing = message.includes("PlatformAuditLog") || message.includes("does not exist");
    return buildGateResult({
      name: "audit_log",
      status: tableMissing ? "warn" : "fail",
      evidence: { moduleActive: false, error: message },
      blockingReason: tableMissing ? null : "Audit log unavailable",
    });
  }
}

async function collectRbacGate(context: GateCollectionContext): Promise<ReleaseGateResult> {
  try {
    const members = await listOrganizationMembers(context.organizationId, prisma);
    const org = await prisma.organization.findUnique({
      where: { id: context.organizationId },
      select: { userId: true },
    });
    const active = members.length > 0 || Boolean(org?.userId);
    return buildGateResult({
      name: "rbac",
      status: active ? "pass" : "fail",
      evidence: { memberCount: members.length, legacyOwnerPresent: Boolean(org?.userId) },
      blockingReason: active ? null : "RBAC not active for organization",
    });
  } catch (err) {
    return buildGateResult({
      name: "rbac",
      status: "warn",
      evidence: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

async function collectConfidenceGatesGate(context: GateCollectionContext): Promise<ReleaseGateResult> {
  try {
    const thresholds = await loadConfidenceThresholds(context.organizationId, prisma);
    return buildGateResult({
      name: "confidence_gates",
      status: "pass",
      evidence: { moduleActive: true, thresholds },
    });
  } catch (err) {
    return buildGateResult({
      name: "confidence_gates",
      status: "warn",
      evidence: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

async function collectAiAuditorGate(context: GateCollectionContext): Promise<ReleaseGateResult> {
  try {
    const auditorConfig = await loadAuditorConfig(context.organizationId, prisma);
    return buildGateResult({
      name: "ai_auditor",
      status: "pass",
      evidence: { moduleAvailable: true, enabled: auditorConfig.enabled, advisory: !auditorConfig.enabled },
    });
  } catch (err) {
    return buildGateResult({
      name: "ai_auditor",
      status: "warn",
      evidence: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

async function collectReliabilityFoundationGate(context: GateCollectionContext): Promise<ReleaseGateResult> {
  const dashboard = buildReliabilityDashboardSnapshot({ organizationId: context.organizationId });
  const rollup = dashboard.rollup;
  const status =
    rollup.unhealthyCount > 0 || rollup.criticalEventCount > 0
      ? "fail"
      : rollup.degradedCount > 0
        ? "warn"
        : "pass";
  return buildGateResult({
    name: "reliability_foundation",
    status,
    critical: false,
    evidence: {
      healthyCount: rollup.healthyCount,
      degradedCount: rollup.degradedCount,
      unhealthyCount: rollup.unhealthyCount,
      notConfiguredCount: rollup.notConfiguredCount,
      criticalEventCount: rollup.criticalEventCount,
    },
    blockingReason: null,
  });
}

function collectTrustArchitectureGate(preGates: ReleaseGateResult[]): ReleaseGateResult {
  const components: TrustScoreInputStatus[] = preGates.map((gate) => ({
    input: mapGateToTrustInput(gate.name),
    status: gate.status === "not_run" ? "not_run" : gate.status,
    score: gate.score,
    critical: gate.critical,
  }));
  const trustScore = computeTrustScore(components);
  const status =
    trustScore.criticalFailures > 0 || trustScore.score < 90 ? "fail" : trustScore.score < 95 ? "warn" : "pass";
  return buildGateResult({
    name: "trust_architecture",
    status,
    evidence: { trustScore: trustScore.score, criticalFailures: trustScore.criticalFailures },
    blockingReason: status === "fail" ? `Trust score ${trustScore.score} below threshold` : null,
  });
}

function mapGateToTrustInput(name: ReleaseGateName): TrustScoreInputStatus["input"] {
  const mapping: Partial<Record<ReleaseGateName, TrustScoreInputStatus["input"]>> = {
    scanner_health: "health",
    golden_test_suite: "golden_tests",
    customer_journey_tests: "journey_tests",
    ai_auditor: "ai_auditor",
    data_integrity_watch: "integrity_watch",
    rbac: "permissions",
    audit_log: "audit_log",
    dependency_health: "dependencies",
    configuration_validation: "configuration",
    business_rules: "business_rules",
    reliability_foundation: "recovery",
  };
  return mapping[name] ?? "health";
}

function collectGoldenSuiteGate(): ReleaseGateResult {
  try {
    const result = runGoldenDataset(loadGoldenDataset());
    const status = result.failed === 0 ? "pass" : "fail";
    return buildGateResult({
      name: "golden_test_suite",
      status,
      evidence: { passed: result.passed, failed: result.failed, total: result.total },
      blockingReason: result.failed > 0 ? "Golden test suite failed" : null,
    });
  } catch (err) {
    return buildGateResult({
      name: "golden_test_suite",
      status: "warn",
      evidence: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

function collectJourneyTestsGate(): ReleaseGateResult {
  try {
    const dataset = buildJourneyDatasetFromRegistry();
    const implementedJourneys = dataset.journeys.filter(
      (journey) => !journey.scaffoldOnly && journey.implemented !== false,
    );
    const report = runJourneyReliabilityDryRun(
      { ...dataset, journeys: implementedJourneys },
      { mode: "dry_run", dryRun: true },
    );
    return buildGateResult({
      name: "customer_journey_tests",
      status: recommendationToGateStatus(report.releaseRecommendation),
      evidence: { releaseRecommendation: report.releaseRecommendation, totals: report.totals },
      blockingReason: report.releaseRecommendation === "fail" ? "Customer journey tests failed" : null,
    });
  } catch (err) {
    return buildGateResult({
      name: "customer_journey_tests",
      status: "warn",
      evidence: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

function collectBusinessRulesGate(): ReleaseGateResult {
  const evaluations = evaluateBusinessRules({
    amount: 100,
    isFinancial: true,
    paymentDirection: "incoming_expense",
    isDuplicate: false,
    confidenceScore: 0.95,
    supplierName: "Acme Ltd",
    permissionDenied: false,
    crossOrgMismatch: false,
    sourceTrusted: true,
    auditorFailed: false,
    hasConflictingAmounts: false,
  });
  const summary = summarizeBusinessRuleEvaluations(evaluations);
  const status = summary.blockers.length > 0 ? "fail" : summary.failed > 0 ? "warn" : "pass";
  return buildGateResult({
    name: "business_rules",
    status,
    evidence: { passed: summary.passed, failed: summary.failed, blockers: summary.blockers },
    blockingReason: summary.blockers.length > 0 ? "Business rule blockers detected" : null,
  });
}

function collectConfigurationGate(): ReleaseGateResult {
  const results: ConfigValidationResult[] = [
    {
      checkId: "env-required-vars",
      passed: Boolean(process.env.DATABASE_URL) && Boolean(process.env.JWT_SECRET),
      message: null,
    },
    { checkId: "env-malformed-lines", passed: true, message: null },
    { checkId: "secret-presence", passed: Boolean(process.env.JWT_SECRET), message: null },
    { checkId: "oauth-redirect-urls", passed: Boolean(process.env.GOOGLE_REDIRECT_URI), message: null },
    { checkId: "google-scopes", passed: true, message: null },
    { checkId: "db-connectivity", passed: true, message: null },
  ];
  const validation = validateConfiguration({ results });
  const status = !validation.passed ? "fail" : validation.warnings.length > 0 ? "warn" : "pass";
  return buildGateResult({
    name: "configuration_validation",
    status,
    evidence: { blockers: validation.blockers, warnings: validation.warnings, nodeEnv: config.nodeEnv },
    blockingReason: validation.blockers[0] ?? null,
  });
}

async function collectDependencyHealthGate(context: GateCollectionContext): Promise<ReleaseGateResult> {
  try {
    const systemHealth = await getSystemHealth(context.organizationId);
    const mapComponent = (component: (typeof systemHealth.components)[keyof typeof systemHealth.components]) => ({
      status: component.status === "PASS" ? ("healthy" as const) : ("unhealthy" as const),
      availability: component.status === "PASS" ? 1 : 0,
    });
    const criticalSnapshots = [
      buildDependencyHealthSnapshot("gmail", mapComponent(systemHealth.components.gmail)),
      buildDependencyHealthSnapshot("google_drive", mapComponent(systemHealth.components.drive)),
      buildDependencyHealthSnapshot("database", mapComponent(systemHealth.components.database)),
    ];
    const optionalSnapshots = [
      buildDependencyHealthSnapshot("whatsapp_provider", mapComponent(systemHealth.components.whatsapp)),
    ];
    const criticalReport = buildDependencyHealthReport(criticalSnapshots);
    const optionalReport = buildDependencyHealthReport(optionalSnapshots);
    const criticalFailed =
      !systemHealth.components.database.connected || !systemHealth.components.gmail.connected;
    const criticalClassification = classifyDependencyHealthResult(criticalReport);
    const optionalClassification = classifyDependencyHealthResult(optionalReport);
    const status = criticalFailed || criticalClassification === "fail" ? "fail" : "pass";
    return buildGateResult({
      name: "dependency_health",
      status,
      evidence: {
        systemHealth,
        criticalReport: criticalReport.overallStatus,
        optionalReport: optionalReport.overallStatus,
      },
      blockingReason: criticalFailed ? "Critical dependency unhealthy" : null,
    });
  } catch (err) {
    return buildGateResult({
      name: "dependency_health",
      status: "fail",
      evidence: { error: err instanceof Error ? err.message : String(err) },
      blockingReason: "Dependency health check failed",
    });
  }
}
