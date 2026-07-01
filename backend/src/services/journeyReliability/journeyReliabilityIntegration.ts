import { buildReliabilityEvent } from "../reliability/reliabilityEventModel.js";
import type { ReliabilityEvent } from "../reliability/reliabilityTypes.js";
import type { JourneyReliabilityReport, JourneyRunResult } from "./journeyTypes.js";

export const JOURNEY_RELIABILITY_EVENT_TYPES = [
  "journey_failed",
  "journey_amount_regression",
  "journey_duplicate_persisted",
  "journey_isolation_violation",
  "journey_dashboard_inconsistency",
  "journey_audit_missing",
  "journey_failure_injection_failed",
] as const;

export type JourneyReliabilityEventType = (typeof JOURNEY_RELIABILITY_EVENT_TYPES)[number];

export function mapJourneyResultsToReliabilityEvents(
  report: JourneyReliabilityReport,
  organizationId: string | null = null,
): ReliabilityEvent[] {
  const events: ReliabilityEvent[] = [];

  for (const result of report.results) {
    if (result.failures.length === 0 && result.warnings.length === 0) continue;

    const eventType = classifyJourneyReliabilityEventType(result);
    const severity = result.criticality === "critical" && result.failures.length > 0 ? "CRITICAL" : "WARNING";

    events.push(
      buildReliabilityEvent({
        subsystem: resolveSubsystemForJourney(result),
        stage: "journey_validation",
        severity,
        timestamp: report.generatedAt,
        organizationId,
        entityId: result.journeyId,
        correlationId: `journey:${eventType}:${result.journeyId}`,
        probableRootCause: result.failures[0] ?? result.warnings[0] ?? eventType,
        suggestedAction: "Review customer journey regression before release",
        autoRecoverable: false,
        message: eventType,
      }),
    );
  }

  for (const result of report.results) {
    for (const fi of result.failureInjectionResults ?? []) {
      if (fi.passed) continue;
      events.push(
        buildReliabilityEvent({
          subsystem: "scanner",
          stage: "failure_injection",
          severity: "IMPORTANT",
          timestamp: report.generatedAt,
          organizationId,
          entityId: result.journeyId,
          correlationId: `journey:fi:${fi.scenarioId}`,
          probableRootCause: fi.failures[0] ?? fi.injection,
          suggestedAction: "Verify failure injection handling",
          autoRecoverable: true,
          message: "journey_failure_injection_failed",
        }),
      );
    }
  }

  return events;
}

function classifyJourneyReliabilityEventType(result: JourneyRunResult): JourneyReliabilityEventType {
  if (result.failures.some((f) => f.includes("correct_amount") || f.includes("amount expected"))) {
    return "journey_amount_regression";
  }
  if (result.tags.includes("duplicate") && result.failures.length > 0) {
    return "journey_duplicate_persisted";
  }
  if (result.failures.some((f) => f.includes("organization_isolation"))) {
    return "journey_isolation_violation";
  }
  if (result.failures.some((f) => f.includes("dashboard"))) {
    return "journey_dashboard_inconsistency";
  }
  if (result.failures.some((f) => f.includes("audit_log"))) {
    return "journey_audit_missing";
  }
  return "journey_failed";
}

function resolveSubsystemForJourney(result: JourneyRunResult): ReliabilityEvent["subsystem"] {
  switch (result.category) {
    case "financial_documents":
    case "manual_upload":
      return "scanner";
    case "whatsapp":
      return "whatsapp";
    case "calendar":
      return "calendar";
    case "tasks":
      return "tasks";
    case "payments":
      return "payments";
    default:
      return "scanner";
  }
}

export function journeyReliabilityHealthExtension(report: JourneyReliabilityReport): {
  journeyPassRate: number | null;
  journeyCriticalFailures: number;
  journeyWarnings: number;
  reliabilityScore: number | null;
  releaseRecommendation: JourneyReliabilityReport["releaseRecommendation"];
} {
  return {
    journeyPassRate: report.journeyPassRate,
    journeyCriticalFailures: report.totals.criticalFailures,
    journeyWarnings: report.totals.warnings,
    reliabilityScore: report.reliabilityScore,
    releaseRecommendation: report.releaseRecommendation,
  };
}

export function bridgeGoldenSuiteToJourney(input: {
  journeyId: string;
  goldenCaseId: string;
  goldenPassed: boolean;
}): { bridged: boolean; message: string } {
  return {
    bridged: true,
    message: `journey ${input.journeyId} ← golden ${input.goldenCaseId} (${input.goldenPassed ? "passed" : "failed"})`,
  };
}
