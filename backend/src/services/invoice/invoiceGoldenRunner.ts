import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assessInvoiceCompleteness,
  INVOICE_COMPLETION_REASON,
  type InvoiceCompletenessAssessment,
} from "../amount/invoiceCompleteness.js";
import {
  isConfidentlyNotFinancialDocument,
} from "../classification/financialDocumentClassification.js";
import { extractDeterministicInvoiceFieldsFromPdfText } from "./pdfTextInvoiceExtraction.js";

export const INVOICE_GOLDEN_VERSION = "invoice-golden-v1" as const;

export type InvoiceGoldenSourceType = "pdf_text" | "pdf_scan" | "image" | "email_body";
export type InvoiceGoldenDestination = "invoices" | "completion" | "excluded";

export type InvoiceGoldenExpected = {
  supplierName: string | null;
  amount: number | null;
  currency: string | null;
  invoiceDate: string | null;
  documentType: string | null;
  destination: InvoiceGoldenDestination;
  reason: string;
  expectedMissingFields?: string[];
  expectedDuplicateState?: string;
  expectedWarnings?: string[];
};

export type InvoiceGoldenRoutingHints = {
  ingestSource?: string | null;
  reviewStatus?: string;
  rawReviewStatus?: string;
  decisionReason?: string | null;
  parsedFieldsJson?: unknown;
  confidenceScore?: string | number | null;
};

export type InvoiceGoldenFixture = {
  id: string;
  file: string;
  language: string;
  sourceType: InvoiceGoldenSourceType;
  origin?: string;
  notes?: string;
  acceptedSupplierAliases?: string[];
  amountTolerance?: number;
  acceptedDateFormats?: string[];
  routingHints?: InvoiceGoldenRoutingHints;
  expected: InvoiceGoldenExpected;
};

export type InvoiceGoldenManifest = {
  version: string;
  description?: string;
  fixtures: InvoiceGoldenFixture[];
};

export type InvoiceGoldenFieldActual = {
  supplierName: string | null;
  amount: number | null;
  currency: string | null;
  invoiceDate: string | null;
  documentType: string | null;
  destination: InvoiceGoldenDestination;
  missingDataReasons: string[];
  approvalReasons: string[];
  completeness: InvoiceCompletenessAssessment | null;
};

export type InvoiceGoldenFailureKind =
  | "supplier"
  | "amount"
  | "date"
  | "type"
  | "currency"
  | "routing"
  | "missing_reason";

export type InvoiceGoldenCaseResult = {
  fixtureId: string;
  passed: boolean;
  failures: Array<{ kind: InvoiceGoldenFailureKind; message: string }>;
  expected: InvoiceGoldenExpected;
  actual: InvoiceGoldenFieldActual;
};

export type InvoiceGoldenTotals = {
  passed: number;
  failed: number;
  extractionFailures: number;
  routingFailures: number;
  falsePositives: number;
  falseNegatives: number;
  byKind: Record<InvoiceGoldenFailureKind, number>;
};

export type InvoiceGoldenReport = {
  version: typeof INVOICE_GOLDEN_VERSION;
  totals: InvoiceGoldenTotals;
  results: InvoiceGoldenCaseResult[];
  tableMarkdown: string;
};

const MISSING_FIELD_ALIASES: Record<string, string> = {
  SUPPLIER_UNIDENTIFIED: INVOICE_COMPLETION_REASON.SUPPLIER_UNIDENTIFIED,
  MISSING_AMOUNT: INVOICE_COMPLETION_REASON.MISSING_AMOUNT,
  MISSING_DATE: INVOICE_COMPLETION_REASON.MISSING_DATE,
  MISSING_CURRENCY: INVOICE_COMPLETION_REASON.MISSING_CURRENCY,
  MISSING_DOCUMENT_TYPE: INVOICE_COMPLETION_REASON.MISSING_DOCUMENT_TYPE,
  DUPLICATE_UNSURE: INVOICE_COMPLETION_REASON.DUPLICATE_UNSURE,
  DUPLICATE_CONFIRMED: INVOICE_COMPLETION_REASON.DUPLICATE_CONFIRMED,
  CAMERA_UNCONFIRMED: INVOICE_COMPLETION_REASON.CAMERA_UNCONFIRMED,
  MULTIPLE_AMOUNTS: INVOICE_COMPLETION_REASON.MULTIPLE_AMOUNTS,
};

function defaultGoldenRoot(): string {
  const candidates = [
    resolve(process.cwd(), "test-fixtures/invoices/golden"),
    resolve(process.cwd(), "backend/test-fixtures/invoices/golden"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "manifest.json"))) return candidate;
  }
  throw new Error(
    `Invoice golden dataset not found. Looked in: ${candidates.join(", ")}`
  );
}

export function loadInvoiceGoldenManifest(rootDir = defaultGoldenRoot()): InvoiceGoldenManifest {
  const raw = readFileSync(join(rootDir, "manifest.json"), "utf8");
  const parsed = JSON.parse(raw) as InvoiceGoldenManifest;
  if (!parsed || !Array.isArray(parsed.fixtures)) {
    throw new Error("Invalid invoice golden manifest: fixtures[] required");
  }
  return parsed;
}

function normalizeSupplier(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value
    .normalize("NFKC")
    .replace(/[״\"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return cleaned || null;
}

function suppliersMatch(
  expected: string | null,
  actual: string | null,
  aliases: string[] | undefined
): boolean {
  const exp = normalizeSupplier(expected);
  const act = normalizeSupplier(actual);
  if (exp === act) return true;
  if (!exp || !act) return false;
  const aliasSet = new Set((aliases ?? []).map((a) => normalizeSupplier(a)).filter(Boolean));
  return aliasSet.has(act) || aliasSet.has(exp);
}

function amountsMatch(expected: number | null, actual: number | null, tolerance = 0.01): boolean {
  if (expected == null && actual == null) return true;
  if (expected == null || actual == null) return false;
  return Math.abs(expected - actual) <= tolerance;
}

function datesMatch(expected: string | null, actual: string | null): boolean {
  if (expected == null && actual == null) return true;
  if (expected == null || actual == null) return false;
  return expected.trim() === actual.trim();
}

function typesMatch(expected: string | null, actual: string | null): boolean {
  if (expected == null && actual == null) return true;
  if (expected == null || actual == null) return false;
  const exp = expected.trim().toLowerCase();
  const act = actual.trim().toLowerCase();
  if (exp === act) return true;
  // Product stores both labels for tax invoices.
  const invoiceFamily = new Set(["invoice", "tax_invoice"]);
  return invoiceFamily.has(exp) && invoiceFamily.has(act);
}

function resolveDestination(
  text: string,
  extracted: ReturnType<typeof extractDeterministicInvoiceFieldsFromPdfText>,
  completeness: InvoiceCompletenessAssessment,
  hints: InvoiceGoldenRoutingHints | undefined
): InvoiceGoldenDestination {
  const excluded = isConfidentlyNotFinancialDocument({
    documentType: extracted.documentType,
    supplierName: extracted.supplierName,
    totalAmount: extracted.totalAmount,
    amount: extracted.totalAmount,
    pdfText: text,
    bodyText: hints?.decisionReason ?? undefined,
    ocrText: text,
    filename: "golden.txt",
  });
  if (excluded) return "excluded";
  return completeness.isComplete ? "invoices" : "completion";
}

export function runInvoiceGoldenFixture(
  fixture: InvoiceGoldenFixture,
  rootDir = defaultGoldenRoot()
): InvoiceGoldenCaseResult {
  const text = readFileSync(join(rootDir, fixture.file), "utf8");
  const extracted = extractDeterministicInvoiceFieldsFromPdfText(text);
  const hints = fixture.routingHints ?? {};
  const reviewStatus = hints.reviewStatus ?? "approved";
  const rawReviewStatus = hints.rawReviewStatus ?? reviewStatus;

  const completeness = assessInvoiceCompleteness({
    supplierName: extracted.supplierName,
    amount: extracted.totalAmount,
    amountResolved: extracted.totalAmount != null,
    currency: extracted.currency,
    currencyExplicit: Boolean(extracted.currency?.trim()),
    date: extracted.documentDate,
    documentDateExplicit: Boolean(extracted.documentDate),
    documentType: extracted.documentType,
    reviewStatus,
    rawReviewStatus,
    confidenceScore: hints.confidenceScore ?? "high",
    decisionReason: hints.decisionReason ?? null,
    parsedFieldsJson: hints.parsedFieldsJson ?? { pdfText: text },
    ingestSource: hints.ingestSource ?? null,
  });

  const destination = resolveDestination(text, extracted, completeness, hints);
  const actual: InvoiceGoldenFieldActual = {
    supplierName: extracted.supplierName,
    amount: extracted.totalAmount,
    currency: extracted.currency,
    invoiceDate: extracted.documentDate,
    documentType: extracted.documentType,
    destination,
    missingDataReasons: completeness.missingDataReasons,
    approvalReasons: completeness.approvalReasons,
    completeness,
  };

  const failures: InvoiceGoldenCaseResult["failures"] = [];
  const expected = fixture.expected;

  if (!suppliersMatch(expected.supplierName, actual.supplierName, fixture.acceptedSupplierAliases)) {
    failures.push({
      kind: "supplier",
      message: `supplier expected ${JSON.stringify(expected.supplierName)} got ${JSON.stringify(actual.supplierName)}`,
    });
  }
  if (!amountsMatch(expected.amount, actual.amount, fixture.amountTolerance ?? 0.01)) {
    failures.push({
      kind: "amount",
      message: `amount expected ${expected.amount ?? "null"} got ${actual.amount ?? "null"}`,
    });
  }
  if (!datesMatch(expected.invoiceDate, actual.invoiceDate)) {
    failures.push({
      kind: "date",
      message: `date expected ${expected.invoiceDate ?? "null"} got ${actual.invoiceDate ?? "null"}`,
    });
  }
  if (!typesMatch(expected.documentType, actual.documentType)) {
    failures.push({
      kind: "type",
      message: `type expected ${expected.documentType ?? "null"} got ${actual.documentType ?? "null"}`,
    });
  }
  if ((expected.currency ?? null) !== (actual.currency ?? null)) {
    failures.push({
      kind: "currency",
      message: `currency expected ${expected.currency ?? "null"} got ${actual.currency ?? "null"}`,
    });
  }
  if (expected.destination !== actual.destination) {
    failures.push({
      kind: "routing",
      message: `destination expected ${expected.destination} got ${actual.destination}`,
    });
  }

  for (const key of expected.expectedMissingFields ?? []) {
    const he = MISSING_FIELD_ALIASES[key] ?? key;
    if (!actual.missingDataReasons.includes(he) && !actual.missingDataReasons.includes(key)) {
      failures.push({
        kind: "missing_reason",
        message: `missingDataReasons missing ${key} (${he}); actual=${JSON.stringify(actual.missingDataReasons)}`,
      });
    }
  }

  return {
    fixtureId: fixture.id,
    passed: failures.length === 0,
    failures,
    expected,
    actual,
  };
}

export function summarizeInvoiceGoldenResults(results: InvoiceGoldenCaseResult[]): InvoiceGoldenTotals {
  const byKind: Record<InvoiceGoldenFailureKind, number> = {
    supplier: 0,
    amount: 0,
    date: 0,
    type: 0,
    currency: 0,
    routing: 0,
    missing_reason: 0,
  };

  let extractionFailures = 0;
  let routingFailures = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const result of results) {
    const kinds = new Set(result.failures.map((f) => f.kind));
    for (const kind of kinds) byKind[kind] += 1;

    const extractionKinds: InvoiceGoldenFailureKind[] = ["supplier", "amount", "date", "type", "currency"];
    if (extractionKinds.some((k) => kinds.has(k))) extractionFailures += 1;
    if (kinds.has("routing") || kinds.has("missing_reason")) routingFailures += 1;

    // FP: expected completion/excluded but routed to invoices
    if (
      (result.expected.destination === "completion" || result.expected.destination === "excluded") &&
      result.actual.destination === "invoices"
    ) {
      falsePositives += 1;
    }
    // FN: expected invoices but routed away
    if (
      result.expected.destination === "invoices" &&
      result.actual.destination !== "invoices"
    ) {
      falseNegatives += 1;
    }
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    passed,
    failed: results.length - passed,
    extractionFailures,
    routingFailures,
    falsePositives,
    falseNegatives,
    byKind,
  };
}

export function formatInvoiceGoldenTable(results: InvoiceGoldenCaseResult[]): string {
  const header =
    "| fixture | supplier | amount | date | type | destination | result |";
  const sep = "|---|---|---|---|---|---|---|";
  const rows = results.map((r) => {
    const mark = (ok: boolean) => (ok ? "ok" : "FAIL");
    const kinds = new Set(r.failures.map((f) => f.kind));
    const supplierOk = !kinds.has("supplier");
    const amountOk = !kinds.has("amount");
    const dateOk = !kinds.has("date");
    const typeOk = !kinds.has("type");
    const destOk = !kinds.has("routing") && !kinds.has("missing_reason");
    return `| ${r.fixtureId} | ${mark(supplierOk)} | ${mark(amountOk)} | ${mark(dateOk)} | ${mark(typeOk)} | ${mark(destOk)} (${r.actual.destination}) | ${r.passed ? "PASS" : "FAIL"} |`;
  });
  return [header, sep, ...rows].join("\n");
}

export function runInvoiceGoldenDataset(rootDir = defaultGoldenRoot()): InvoiceGoldenReport {
  const manifest = loadInvoiceGoldenManifest(rootDir);
  const results = manifest.fixtures.map((fixture) => runInvoiceGoldenFixture(fixture, rootDir));
  const totals = summarizeInvoiceGoldenResults(results);
  return {
    version: INVOICE_GOLDEN_VERSION,
    totals,
    results,
    tableMarkdown: formatInvoiceGoldenTable(results),
  };
}

export function printInvoiceGoldenReport(report: InvoiceGoldenReport): void {
  console.log(report.tableMarkdown);
  console.log("");
  console.log(
    `totals: passed=${report.totals.passed} failed=${report.totals.failed} extractionFailures=${report.totals.extractionFailures} routingFailures=${report.totals.routingFailures} falsePositives=${report.totals.falsePositives} falseNegatives=${report.totals.falseNegatives}`
  );
  console.log(`byKind: ${JSON.stringify(report.totals.byKind)}`);
  for (const result of report.results.filter((r) => !r.passed)) {
    console.log(`\nFAIL ${result.fixtureId}`);
    for (const failure of result.failures) {
      console.log(`  [${failure.kind}] ${failure.message}`);
    }
    console.log(
      `  actual=${JSON.stringify({
        supplierName: result.actual.supplierName,
        amount: result.actual.amount,
        currency: result.actual.currency,
        invoiceDate: result.actual.invoiceDate,
        documentType: result.actual.documentType,
        destination: result.actual.destination,
        missingDataReasons: result.actual.missingDataReasons,
      })}`
    );
  }
}
