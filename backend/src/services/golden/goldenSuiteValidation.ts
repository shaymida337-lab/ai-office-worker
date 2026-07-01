import type {
  GoldenAllowedVariance,
  GoldenSuiteCase,
  GoldenSuiteDataset,
} from "./goldenSuiteTypes.js";
import {
  GOLDEN_CASE_CRITICALITIES,
  GOLDEN_PAYMENT_DIRECTIONS,
  GOLDEN_PERSISTENCE_ACTIONS,
  GOLDEN_SOURCE_CHANNELS,
  GOLDEN_SUITE_VERSION,
} from "./goldenSuiteTypes.js";

export type GoldenSuiteValidationIssue = {
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
  issues: GoldenSuiteValidationIssue[],
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
  issues: GoldenSuiteValidationIssue[],
): T | null {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    issues.push({ path, message: `expected one of: ${allowed.join(", ")}` });
    return null;
  }
  return value as T;
}

export function validateGoldenAllowedVariance(
  value: unknown,
  path: string,
): GoldenSuiteValidationIssue[] {
  const issues: GoldenSuiteValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path, message: "expected allowedVariance object" });
    return issues;
  }
  if (value.confidenceScoreDelta != null) {
    const delta = Number(value.confidenceScoreDelta);
    if (!Number.isFinite(delta) || delta < 0 || delta > 1) {
      issues.push({ path: `${path}.confidenceScoreDelta`, message: "expected 0–1 delta" });
    }
  }
  if (value.metadata != null && !Array.isArray(value.metadata)) {
    issues.push({ path: `${path}.metadata`, message: "expected string array" });
  }
  return issues;
}

export function validateGoldenSuiteCase(value: unknown, index?: number): GoldenSuiteValidationIssue[] {
  const path = index == null ? "case" : `cases[${index}]`;
  const issues: GoldenSuiteValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ path, message: "expected case object" }];
  }

  requireString(value, "caseId", path, issues);
  if (value.version != null && value.version !== GOLDEN_SUITE_VERSION) {
    issues.push({ path: `${path}.version`, message: `expected ${GOLDEN_SUITE_VERSION}` });
  }
  requireEnum(value.sourceChannel, GOLDEN_SOURCE_CHANNELS, `${path}.sourceChannel`, issues);
  if (value.documentFileRef != null && typeof value.documentFileRef !== "string") {
    issues.push({ path: `${path}.documentFileRef`, message: "expected string or null" });
  }
  requireString(value, "expectedDocumentType", path, issues);
  requireEnum(
    value.expectedPaymentDirection,
    GOLDEN_PAYMENT_DIRECTIONS,
    `${path}.expectedPaymentDirection`,
    issues,
  );
  requireEnum(
    value.expectedPersistenceAction,
    GOLDEN_PERSISTENCE_ACTIONS,
    `${path}.expectedPersistenceAction`,
    issues,
  );
  requireEnum(value.criticality, GOLDEN_CASE_CRITICALITIES, `${path}.criticality`, issues);
  if (!Array.isArray(value.tags)) {
    issues.push({ path: `${path}.tags`, message: "expected tags array" });
  }
  issues.push(...validateGoldenAllowedVariance(value.allowedVariance, `${path}.allowedVariance`));

  if (
    value.expectedAmount === 0 &&
    isRecord(value.allowedVariance) &&
    value.allowedVariance.amount !== true
  ) {
    const docType = String(value.expectedDocumentType ?? "");
    if (!docType.includes("non_financial")) {
      issues.push({
        path: `${path}.expectedAmount`,
        message: "zero amount requires allowedVariance.amount=true for financial documents",
      });
    }
  }

  return issues;
}

export function validateGoldenSuiteDataset(dataset: unknown): GoldenSuiteValidationIssue[] {
  const issues: GoldenSuiteValidationIssue[] = [];
  if (!isRecord(dataset)) {
    return [{ path: "dataset", message: "expected object" }];
  }
  if (dataset.version !== GOLDEN_SUITE_VERSION) {
    issues.push({ path: "version", message: `expected ${GOLDEN_SUITE_VERSION}` });
  }
  if (!Array.isArray(dataset.cases)) {
    issues.push({ path: "cases", message: "expected array" });
    return issues;
  }
  const seen = new Set<string>();
  dataset.cases.forEach((item, index) => {
    issues.push(...validateGoldenSuiteCase(item, index));
    if (isRecord(item) && typeof item.caseId === "string") {
      if (seen.has(item.caseId)) {
        issues.push({ path: `cases[${index}].caseId`, message: `duplicate ${item.caseId}` });
      }
      seen.add(item.caseId);
    }
  });
  return issues;
}

export function assertValidGoldenSuiteDataset(
  dataset: unknown,
): asserts dataset is GoldenSuiteDataset {
  const issues = validateGoldenSuiteDataset(dataset);
  if (issues.length > 0) {
    throw new Error(
      `Invalid golden suite dataset: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
  }
}

export function isGoldenAllowedVariance(value: unknown): value is GoldenAllowedVariance {
  return validateGoldenAllowedVariance(value, "allowedVariance").length === 0 && isRecord(value);
}

export function isGoldenSuiteCase(value: unknown): value is GoldenSuiteCase {
  return validateGoldenSuiteCase(value).length === 0 && isRecord(value);
}
