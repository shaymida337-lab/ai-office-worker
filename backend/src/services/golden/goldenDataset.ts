import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  GoldenCase,
  GoldenDataset,
  GoldenValidationIssue,
} from "./goldenTypes.js";
import { GOLDEN_VERSION } from "./goldenTypes.js";

function resolveGoldenFixturePath(): string {
  const candidates = [
    join(__dirname, "fixtures", "golden-documents.sample.json"),
    join(process.cwd(), "src", "services", "golden", "fixtures", "golden-documents.sample.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export const DEFAULT_GOLDEN_FIXTURE_PATH = resolveGoldenFixturePath();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, path: string, issues: GoldenValidationIssue[]) {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path: `${path}.${key}`, message: "expected non-empty string" });
    return null;
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string, path: string, issues: GoldenValidationIssue[]) {
  const value = record[key];
  if (typeof value !== "boolean") {
    issues.push({ path: `${path}.${key}`, message: "expected boolean" });
    return null;
  }
  return value;
}

function requireArray(record: Record<string, unknown>, key: string, path: string, issues: GoldenValidationIssue[]) {
  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: "expected array" });
    return null;
  }
  return value;
}

export function validateGoldenDataset(dataset: unknown): GoldenValidationIssue[] {
  const issues: GoldenValidationIssue[] = [];
  if (!isRecord(dataset)) {
    return [{ path: "dataset", message: "expected object" }];
  }

  if (dataset.version !== GOLDEN_VERSION) {
    issues.push({ path: "version", message: `expected ${GOLDEN_VERSION}` });
  }

  const cases = requireArray(dataset, "cases", "dataset", issues);
  if (!cases) return issues;

  if (cases.length < 10) {
    issues.push({ path: "cases", message: "expected at least 10 golden cases" });
  }

  const seenIds = new Set<string>();
  for (let index = 0; index < cases.length; index += 1) {
    const path = `cases[${index}]`;
    const item = cases[index];
    if (!isRecord(item)) {
      issues.push({ path, message: "expected case object" });
      continue;
    }

    const id = requireString(item, "id", path, issues);
    if (id) {
      if (seenIds.has(id)) {
        issues.push({ path: `${path}.id`, message: `duplicate case id ${id}` });
      }
      seenIds.add(id);
    }

    requireString(item, "description", path, issues);
    requireString(item, "documentType", path, issues);
    requireString(item, "channel", path, issues);
    requireString(item, "language", path, issues);

    const input = item.input;
    if (!isRecord(input)) {
      issues.push({ path: `${path}.input`, message: "expected object" });
    } else {
      requireString(input, "organizationId", `${path}.input`, issues);
      requireArray(input, "amountCandidates", `${path}.input`, issues);
      requireArray(input, "supplierCandidates", `${path}.input`, issues);
      if (!isRecord(input.fingerprint)) {
        issues.push({ path: `${path}.input.fingerprint`, message: "expected object" });
      } else {
        requireString(input.fingerprint, "organizationId", `${path}.input.fingerprint`, issues);
        requireString(input.fingerprint, "supplierName", `${path}.input.fingerprint`, issues);
      }
    }

    const expected = item.expected;
    if (!isRecord(expected)) {
      issues.push({ path: `${path}.expected`, message: "expected object" });
    } else {
      requireString(expected, "outcomeStatus", `${path}.expected`, issues);
      requireBoolean(expected, "shouldAutoSave", `${path}.expected`, issues);
      requireBoolean(expected, "shouldNeedReview", `${path}.expected`, issues);
      requireBoolean(expected, "shouldReject", `${path}.expected`, issues);
      requireString(expected, "reason", `${path}.expected`, issues);
    }
  }

  return issues;
}

export function assertValidGoldenDataset(dataset: unknown): asserts dataset is GoldenDataset {
  const issues = validateGoldenDataset(dataset);
  if (issues.length > 0) {
    const details = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid golden dataset: ${details}`);
  }
}

export function loadGoldenDataset(fixturePath: string = DEFAULT_GOLDEN_FIXTURE_PATH): GoldenDataset {
  const raw = readFileSync(fixturePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertValidGoldenDataset(parsed);
  return parsed;
}

export function listGoldenCaseIds(dataset: GoldenDataset): string[] {
  return dataset.cases.map((item) => item.id);
}

export function findGoldenCase(dataset: GoldenDataset, caseId: string): GoldenCase | undefined {
  return dataset.cases.find((item) => item.id === caseId);
}
