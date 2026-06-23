import { computeCanonicalAmount } from "../amount/canonicalAmount.js";
import type { CanonicalAmountDocumentType } from "../amount/canonicalAmount.js";
import { computeCanonicalFingerprint } from "../dedup/sharedMatcher.js";
import { computeDocumentOutcome } from "../outcome/outcomeEngine.js";
import { computeCanonicalSupplier } from "../supplier/canonicalSupplier.js";
import { computeTrustDecision } from "../trust/trustEngine.js";
import { computeFinancialSanity } from "../validation/financialSanity.js";
import type {
  GoldenCase,
  GoldenCaseActual,
  GoldenCaseExpected,
  GoldenCaseResult,
  GoldenDataset,
  GoldenDatasetResult,
} from "./goldenTypes.js";
import { GOLDEN_VERSION } from "./goldenTypes.js";
import { loadGoldenDataset } from "./goldenDataset.js";

function mapGoldenDocumentType(documentType: string): CanonicalAmountDocumentType {
  const normalized = documentType.toLowerCase();
  if (normalized === "receipt") return "receipt";
  if (normalized === "payment_request") return "payment_request";
  if (normalized === "credit_note") return "credit_note";
  if (normalized === "quote") return "quote";
  if (normalized === "tax_invoice_receipt") return "tax_invoice_receipt";
  if (normalized === "invoice" || normalized === "tax_invoice") return "tax_invoice";
  return "unknown";
}

function mapInvoiceDocumentType(documentType: string): string {
  const normalized = documentType.toLowerCase();
  if (normalized === "invoice") return "tax_invoice";
  return normalized;
}

function deriveGoldenFlags(actual: GoldenCaseActual) {
  const shouldAutoSave = actual.trustDecision === "AUTO_SAVE" && actual.outcomeStatus === "SAVED";
  const shouldNeedReview =
    actual.outcomeStatus === "NEEDS_REVIEW" ||
    (actual.trustDecision === "NEEDS_REVIEW" && actual.outcomeStatus === "SAVED");
  const shouldReject =
    actual.outcomeStatus === "BLOCKED" ||
    actual.outcomeStatus === "ERROR" ||
    actual.outcomeStatus === "DUPLICATE" ||
    actual.outcomeStatus === "NOT_FINANCIAL";
  return { shouldAutoSave, shouldNeedReview, shouldReject };
}

function compareNullableString(label: string, expected: string | null | undefined, actual: string | null, failures: string[]) {
  if (expected === undefined) return;
  if (expected !== actual) {
    failures.push(`${label} expected "${expected}" got "${actual ?? "null"}"`);
  }
}

function compareNullableNumber(label: string, expected: number | null | undefined, actual: number | null, failures: string[]) {
  if (expected === undefined) return;
  if (expected !== actual) {
    failures.push(`${label} expected ${expected ?? "null"} got ${actual ?? "null"}`);
  }
}

export function compareGoldenExpected(expected: GoldenCaseExpected, actual: GoldenCaseActual): string[] {
  const failures: string[] = [];

  compareNullableString("supplierName", expected.supplierName, actual.supplierName, failures);
  compareNullableNumber("amount", expected.amount, actual.amount, failures);

  if (expected.documentType !== undefined && expected.documentType !== actual.documentType) {
    failures.push(`documentType expected "${expected.documentType}" got "${actual.documentType}"`);
  }
  if (expected.outcomeStatus !== actual.outcomeStatus) {
    failures.push(`outcomeStatus expected "${expected.outcomeStatus}" got "${actual.outcomeStatus}"`);
  }

  const flags = deriveGoldenFlags(actual);
  if (expected.shouldAutoSave !== flags.shouldAutoSave) {
    failures.push(`shouldAutoSave expected ${expected.shouldAutoSave} got ${flags.shouldAutoSave}`);
  }
  if (expected.shouldNeedReview !== flags.shouldNeedReview) {
    failures.push(`shouldNeedReview expected ${expected.shouldNeedReview} got ${flags.shouldNeedReview}`);
  }
  if (expected.shouldReject !== flags.shouldReject) {
    failures.push(`shouldReject expected ${expected.shouldReject} got ${flags.shouldReject}`);
  }

  return failures;
}

export function runGoldenCase(testCase: GoldenCase): GoldenCaseResult {
  const documentType = mapGoldenDocumentType(testCase.documentType);
  const moneyDecision = computeCanonicalAmount({
    organizationId: testCase.input.organizationId,
    documentType,
    currency: testCase.input.currency ?? "ILS",
    source: testCase.channel,
    candidates: testCase.input.amountCandidates,
  });

  const supplierDecision = computeCanonicalSupplier({
    organizationId: testCase.input.organizationId,
    channel: testCase.channel,
    candidates: testCase.input.supplierCandidates,
  });

  const fingerprint = computeCanonicalFingerprint({
    organizationId: testCase.input.fingerprint.organizationId,
    supplierName: testCase.input.fingerprint.supplierName,
    supplierTaxId: testCase.input.fingerprint.supplierTaxId ?? null,
    invoiceNumber: testCase.input.fingerprint.invoiceNumber ?? testCase.input.invoiceNumber ?? null,
    totalAmount: testCase.input.fingerprint.totalAmount ?? moneyDecision.selectedAmount,
    documentDate: testCase.input.fingerprint.documentDate ?? testCase.input.documentDate ?? null,
    documentType: testCase.input.fingerprint.documentType ?? mapInvoiceDocumentType(testCase.documentType),
  });

  const duplicateFingerprints = (testCase.input.fseContext?.duplicateFingerprints ?? []).map((value) =>
    value === "__SELF_FINGERPRINT__" ? fingerprint.fingerprint : value
  ).filter((value): value is string => Boolean(value));

  const fseDecision = computeFinancialSanity({
    organizationId: testCase.input.organizationId,
    supplierDecision,
    moneyDecision,
    fingerprint,
    invoiceNumber: testCase.input.invoiceNumber ?? testCase.input.fingerprint.invoiceNumber ?? null,
    documentDate: testCase.input.documentDate ?? testCase.input.fingerprint.documentDate ?? "2026-05-15",
    dueDate: testCase.input.dueDate ?? null,
    currency: testCase.input.currency ?? "ILS",
    invoiceData: {
      documentType: mapInvoiceDocumentType(testCase.documentType),
      rawOcrText: testCase.input.rawOcrText ?? `${testCase.description} synthetic fixture`,
      extractionSource: testCase.channel,
    },
    context: testCase.input.fseContext
      ? {
          referenceDate: testCase.input.fseContext.referenceDate ?? "2026-06-01",
          expectedCurrency: testCase.input.fseContext.expectedCurrency ?? testCase.input.currency ?? "ILS",
          duplicateFingerprints,
          supplierHistory: testCase.input.fseContext.supplierHistory ?? null,
        }
      : {
          referenceDate: "2026-06-01",
          expectedCurrency: testCase.input.currency ?? "ILS",
        },
  });

  const trustDecision = computeTrustDecision({
    fingerprint,
    moneyDecision,
    supplierDecision,
    fseDecision,
  });

  const outcome = computeDocumentOutcome({
    trustDecision,
    fseDecision,
    supplierDecision,
    moneyDecision,
    fingerprint,
    context: {
      documentType: testCase.documentType,
      duplicateDetected: testCase.input.outcomeContext?.duplicateDetected ?? false,
      duplicateMatchIdentity: testCase.input.outcomeContext?.duplicateMatchIdentity ?? null,
      reviewReason: testCase.input.outcomeContext?.reviewReason ?? null,
      pipelineError: testCase.input.outcomeContext?.pipelineError ?? null,
      processingStage: testCase.input.outcomeContext?.processingStage ?? null,
    },
  });

  const actual: GoldenCaseActual = {
    supplierName: supplierDecision.supplierName,
    amount: moneyDecision.selectedAmount,
    documentType: testCase.documentType,
    outcomeStatus: outcome.status,
    trustDecision: trustDecision.decision,
    trustReasonCode: trustDecision.reasonCode,
    moneyStatus: moneyDecision.status,
    supplierStatus: supplierDecision.status,
    fseStatus: fseDecision.overallStatus,
  };

  const failures = compareGoldenExpected(testCase.expected, actual);

  return {
    caseId: testCase.id,
    description: testCase.description,
    passed: failures.length === 0,
    failures,
    expected: testCase.expected,
    actual,
  };
}

export function runGoldenDataset(dataset: GoldenDataset = loadGoldenDataset()): GoldenDatasetResult {
  const results = dataset.cases.map((testCase) => runGoldenCase(testCase));
  const passed = results.filter((result) => result.passed).length;

  return {
    version: dataset.version ?? GOLDEN_VERSION,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

export function formatGoldenFailure(result: GoldenCaseResult): string {
  const detail = result.failures.join("; ");
  return `Golden case ${result.caseId} failed (${result.description}): ${detail}`;
}
