import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractDeterministicInvoiceFieldsFromPdfText } from "../invoice/pdfTextInvoiceExtraction.js";
import type { ExtractionFieldEvidence } from "./extractionTypes.js";

export type ExtractionFixtureExpected = {
  supplier: string | null;
  buyer?: string | null;
  issueDate: string | null;
  total: number | null;
  currency: string | null;
  documentType: string | null;
  subtotal?: number | null;
  vat?: number | null;
  amountDue?: number | null;
  amountPaid?: number | null;
};

export type ExtractionFixtureCase = {
  id: string;
  file: string;
  locale: "IL" | "US" | "EU" | "UK";
  notes?: string;
  senderMustNotBecomeSupplier?: string;
  emailDateMustNotBecomeIssueDate?: string;
  expected: ExtractionFixtureExpected;
};

export type ExtractionFixtureManifest = {
  version: string;
  fixtures: ExtractionFixtureCase[];
};

export type ExtractionFixtureFieldMetric = {
  field: keyof ExtractionFixtureExpected | "buyer";
  correct: number;
  incorrect: number;
  missingWhenExpected: number;
  falsePositive: number;
};

function defaultFixtureRoot(): string {
  const candidates = [
    resolve(process.cwd(), "test-fixtures/invoices/extraction"),
    resolve(process.cwd(), "backend/test-fixtures/invoices/extraction"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "manifest.json"))) return candidate;
  }
  throw new Error(`Extraction fixture dataset not found. Looked in: ${candidates.join(", ")}`);
}

export function loadExtractionFixtureManifest(rootDir = defaultFixtureRoot()): ExtractionFixtureManifest {
  const raw = readFileSync(join(rootDir, "manifest.json"), "utf8");
  return JSON.parse(raw) as ExtractionFixtureManifest;
}

export function loadExtractionFixtureText(fixture: ExtractionFixtureCase, rootDir = defaultFixtureRoot()): string {
  return readFileSync(join(rootDir, fixture.file), "utf8");
}

function normalize(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value.trim().toLowerCase();
  return cleaned || null;
}

function numberMatch(expected: number | null | undefined, actual: number | null | undefined, tolerance = 0.01): boolean {
  if (expected == null && actual == null) return true;
  if (expected == null || actual == null) return false;
  return Math.abs(expected - actual) <= tolerance;
}

export function evaluateExtractionFixture(
  fixture: ExtractionFixtureCase,
  evidence: ExtractionFieldEvidence[],
  rootDir = defaultFixtureRoot()
): {
  passed: boolean;
  failures: string[];
  extracted: Partial<Record<keyof ExtractionFixtureExpected, string | number | null>>;
} {
  const text = loadExtractionFixtureText(fixture, rootDir);
  const deterministic = extractDeterministicInvoiceFieldsFromPdfText(text);
  const byField = new Map(evidence.map((item) => [item.field, item]));

  const extracted = {
    supplier: (byField.get("supplier")?.normalizedValue as string | null) ?? deterministic.supplierName,
    buyer: byField.get("buyer")?.normalizedValue as string | null ?? null,
    issueDate: (byField.get("issue_date")?.normalizedValue as string | null) ?? deterministic.documentDate,
    total: (byField.get("total")?.normalizedValue as number | null) ?? deterministic.totalAmount,
    currency: (byField.get("currency")?.normalizedValue as string | null) ?? deterministic.currency,
    documentType: (byField.get("document_type")?.normalizedValue as string | null) ?? deterministic.documentType,
    subtotal: byField.get("subtotal")?.normalizedValue as number | null ?? null,
    vat: byField.get("vat")?.normalizedValue as number | null ?? null,
  };

  const failures: string[] = [];
  const exp = fixture.expected;

  if (exp.supplier != null) {
    if (extracted.supplier == null) failures.push("supplier missing when expected");
    else if (normalize(extracted.supplier) !== normalize(exp.supplier)) failures.push(`supplier expected=${exp.supplier} actual=${extracted.supplier}`);
  } else if (extracted.supplier != null) {
    failures.push(`supplier false positive: ${extracted.supplier}`);
  }

  if (exp.buyer != null) {
    if (extracted.buyer == null) failures.push("buyer missing when expected");
    else if (normalize(extracted.buyer) !== normalize(exp.buyer)) failures.push(`buyer expected=${exp.buyer} actual=${extracted.buyer}`);
  }

  if (exp.issueDate != null) {
    if (extracted.issueDate == null) failures.push("issueDate missing when expected");
    else if (extracted.issueDate !== exp.issueDate) failures.push(`issueDate expected=${exp.issueDate} actual=${extracted.issueDate}`);
  } else if (extracted.issueDate != null && fixture.emailDateMustNotBecomeIssueDate) {
    if (extracted.issueDate === fixture.emailDateMustNotBecomeIssueDate) {
      failures.push(`issueDate incorrectly used email date ${fixture.emailDateMustNotBecomeIssueDate}`);
    }
  } else if (extracted.issueDate != null && exp.issueDate == null) {
    failures.push(`issueDate false positive: ${extracted.issueDate}`);
  }

  if (!numberMatch(exp.total, extracted.total as number | null)) {
    failures.push(`total expected=${exp.total ?? "null"} actual=${extracted.total ?? "null"}`);
  }

  if (exp.currency != null) {
    if (normalize(extracted.currency) !== normalize(exp.currency)) {
      failures.push(`currency expected=${exp.currency} actual=${extracted.currency ?? "null"}`);
    }
  } else if (extracted.currency != null) {
    failures.push(`currency false positive: ${extracted.currency}`);
  }

  if (exp.documentType != null) {
    if (normalize(extracted.documentType) !== normalize(exp.documentType)) {
      failures.push(`documentType expected=${exp.documentType} actual=${extracted.documentType ?? "null"}`);
    }
  } else if (extracted.documentType != null) {
    failures.push(`documentType false positive: ${extracted.documentType}`);
  }

  if (fixture.senderMustNotBecomeSupplier && normalize(extracted.supplier) === normalize(fixture.senderMustNotBecomeSupplier)) {
    failures.push(`sender substituted for supplier: ${fixture.senderMustNotBecomeSupplier}`);
  }

  return { passed: failures.length === 0, failures, extracted };
}

export function buildFixtureEvidenceFromText(text: string): ExtractionFieldEvidence[] {
  const deterministic = extractDeterministicInvoiceFieldsFromPdfText(text);
  const buyerMatch = text.match(/(?:Bill To|לכבוד|מקבל)[:\s]+(.+)/i);
  const evidence: ExtractionFieldEvidence[] = [];

  const push = (
    field: ExtractionFieldEvidence["field"],
    rawValue: string | number | null,
    normalizedValue: string | number | null,
    evidenceLabel: string | null = null
  ) => {
    if (rawValue == null && normalizedValue == null) return;
    if (typeof rawValue === "string" && !rawValue.trim()) return;
    evidence.push({
      field,
      rawValue: rawValue == null ? null : String(rawValue),
      normalizedValue,
      source: "PDF_TEXT",
      pageIndex: null,
      confidence: 0.85,
      evidenceLabel,
    });
  };

  push("supplier", deterministic.supplierName, deterministic.supplierName, "supplier");
  push("buyer", buyerMatch?.[1]?.trim() ?? null, buyerMatch?.[1]?.trim() ?? null, "buyer");
  push("issue_date", deterministic.documentDate, deterministic.documentDate, "issue_date");
  push("total", deterministic.totalAmount, deterministic.totalAmount, "invoice_total");
  push("currency", deterministic.currency, deterministic.currency, "currency");
  push("document_type", deterministic.documentType, deterministic.documentType, "document_type");

  return evidence;
}

export function computeExtractionFixtureMetrics(results: Array<{ fixture: ExtractionFixtureCase; passed: boolean; extracted: Partial<Record<string, string | number | null>> }>): ExtractionFixtureFieldMetric[] {
  const fields: Array<keyof ExtractionFixtureExpected | "buyer"> = [
    "supplier",
    "buyer",
    "issueDate",
    "total",
    "currency",
    "documentType",
  ];
  return fields.map((field) => {
    let correct = 0;
    let incorrect = 0;
    let missingWhenExpected = 0;
    let falsePositive = 0;

    for (const result of results) {
      const expected = result.fixture.expected[field as keyof ExtractionFixtureExpected];
      const actual = result.extracted[field as keyof typeof result.extracted] ?? null;
      if (expected == null) {
        if (actual != null) falsePositive += 1;
        else correct += 1;
      } else if (actual == null) {
        missingWhenExpected += 1;
      } else if (typeof expected === "number") {
        if (numberMatch(expected, actual as number)) correct += 1;
        else incorrect += 1;
      } else if (normalize(String(expected)) === normalize(String(actual))) {
        correct += 1;
      } else {
        incorrect += 1;
      }
    }

    return { field, correct, incorrect, missingWhenExpected, falsePositive };
  });
}
