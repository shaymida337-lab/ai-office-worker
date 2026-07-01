import type {
  JourneyDataset,
  JourneyDefinition,
  JourneyFailureScenario,
  JourneyStep,
} from "./journeyTypes.js";
import {
  JOURNEY_ASSERTION_KINDS,
  JOURNEY_CATEGORIES,
  JOURNEY_CRITICALITIES,
  JOURNEY_FAILURE_INJECTION_KINDS,
  JOURNEY_RELIABILITY_VERSION,
  JOURNEY_STEP_KINDS,
} from "./journeyTypes.js";

export type JourneyValidationIssue = {
  path: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: JourneyValidationIssue[],
): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path: `${path}.${key}`, message: "expected non-empty string" });
    return null;
  }
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: JourneyValidationIssue[],
): T | null {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    issues.push({ path, message: `expected one of: ${allowed.join(", ")}` });
    return null;
  }
  return value as T;
}

export function validateJourneyStep(value: unknown, index: number): JourneyValidationIssue[] {
  const path = `steps[${index}]`;
  const issues: JourneyValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, message: "expected step object" }];

  requireString(value, "stepId", path, issues);
  requireEnum(value.kind, JOURNEY_STEP_KINDS, `${path}.kind`, issues);
  requireString(value, "subsystem", path, issues);
  requireString(value, "label", path, issues);
  return issues;
}

export function validateJourneyFailureScenario(
  value: unknown,
  index: number,
): JourneyValidationIssue[] {
  const path = `failureScenarios[${index}]`;
  const issues: JourneyValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, message: "expected failure scenario object" }];

  requireString(value, "scenarioId", path, issues);
  requireEnum(value.injection, JOURNEY_FAILURE_INJECTION_KINDS, `${path}.injection`, issues);
  requireString(value, "atStepId", path, issues);

  if (!isRecord(value.expectedBehavior)) {
    issues.push({ path: `${path}.expectedBehavior`, message: "expected object" });
  }
  return issues;
}

export function validateJourneyDefinition(value: unknown, index?: number): JourneyValidationIssue[] {
  const path = index == null ? "journey" : `journeys[${index}]`;
  const issues: JourneyValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, message: "expected journey object" }];

  requireString(value, "journeyId", path, issues);
  if (value.version != null && value.version !== JOURNEY_RELIABILITY_VERSION) {
    issues.push({ path: `${path}.version`, message: `expected ${JOURNEY_RELIABILITY_VERSION}` });
  }
  requireEnum(value.category, JOURNEY_CATEGORIES, `${path}.category`, issues);
  requireString(value, "title", path, issues);
  requireString(value, "description", path, issues);
  requireEnum(value.criticality, JOURNEY_CRITICALITIES, `${path}.criticality`, issues);

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    issues.push({ path: `${path}.steps`, message: "expected non-empty steps array" });
  } else {
    value.steps.forEach((step, i) => issues.push(...validateJourneyStep(step, i)));
  }

  if (!Array.isArray(value.assertions)) {
    issues.push({ path: `${path}.assertions`, message: "expected assertions array" });
  } else {
    for (const [i, assertion] of value.assertions.entries()) {
      if (typeof assertion !== "string" || !JOURNEY_ASSERTION_KINDS.includes(assertion as never)) {
        issues.push({ path: `${path}.assertions[${i}]`, message: "invalid assertion kind" });
      }
    }
  }

  if (!isRecord(value.expectedOutcome)) {
    issues.push({ path: `${path}.expectedOutcome`, message: "expected outcome object required" });
  }

  if (Array.isArray(value.failureScenarios)) {
    value.failureScenarios.forEach((scenario, i) =>
      issues.push(...validateJourneyFailureScenario(scenario, i)),
    );
  }

  if (!Array.isArray(value.tags)) {
    issues.push({ path: `${path}.tags`, message: "expected tags array" });
  }

  return issues;
}

export function validateJourneyDataset(dataset: unknown): JourneyValidationIssue[] {
  const issues: JourneyValidationIssue[] = [];
  if (!isRecord(dataset)) return [{ path: "dataset", message: "expected object" }];

  if (dataset.version !== JOURNEY_RELIABILITY_VERSION) {
    issues.push({ path: "version", message: `expected ${JOURNEY_RELIABILITY_VERSION}` });
  }
  if (!Array.isArray(dataset.journeys)) {
    issues.push({ path: "journeys", message: "expected array" });
    return issues;
  }

  const seen = new Set<string>();
  dataset.journeys.forEach((item, index) => {
    issues.push(...validateJourneyDefinition(item, index));
    if (isRecord(item) && typeof item.journeyId === "string") {
      if (seen.has(item.journeyId)) {
        issues.push({ path: `journeys[${index}].journeyId`, message: `duplicate ${item.journeyId}` });
      }
      seen.add(item.journeyId);
    }
  });
  return issues;
}

export function assertValidJourneyDataset(dataset: unknown): asserts dataset is JourneyDataset {
  const issues = validateJourneyDataset(dataset);
  if (issues.length > 0) {
    throw new Error(
      `Invalid journey dataset: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
  }
}

export function validateJourneyStepOrder(steps: JourneyStep[]): JourneyValidationIssue[] {
  const issues: JourneyValidationIssue[] = [];
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.stepId)) {
      issues.push({ path: `steps.${step.stepId}`, message: "duplicate stepId" });
    }
    ids.add(step.stepId);
  }
  return issues;
}

export function validateFailureScenarioStepRefs(
  journey: JourneyDefinition,
): JourneyValidationIssue[] {
  const issues: JourneyValidationIssue[] = [];
  const stepIds = new Set(journey.steps.map((s) => s.stepId));
  for (const scenario of journey.failureScenarios ?? []) {
    if (!stepIds.has(scenario.atStepId)) {
      issues.push({
        path: `failureScenarios.${scenario.scenarioId}.atStepId`,
        message: `step ${scenario.atStepId} not found in journey`,
      });
    }
  }
  return issues;
}

export function isJourneyDefinition(value: unknown): value is JourneyDefinition {
  return validateJourneyDefinition(value).length === 0 && isRecord(value);
}

export function isJourneyFailureScenario(value: unknown): value is JourneyFailureScenario {
  return validateJourneyFailureScenario(value, 0).length === 0 && isRecord(value);
}
