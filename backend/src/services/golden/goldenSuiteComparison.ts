import type { GoldenCaseActual, GoldenCaseExpected } from "./goldenTypes.js";
import type {
  GoldenAllowedVariance,
  GoldenSuiteCase,
  GoldenSuiteFieldChange,
} from "./goldenSuiteTypes.js";

export type GoldenSuiteActualSnapshot = {
  supplierName: string | null;
  amount: number | null;
  documentType: string;
  outcomeStatus: string;
  reviewStatus?: string | null;
  persistenceAction?: string | null;
  paymentDirection?: string | null;
  fingerprint?: string | null;
  confidenceScore?: number | null;
  currency?: string | null;
  invoiceNumber?: string | null;
  documentDate?: string | null;
};

export function snapshotFromGoldenPipeline(
  expected: GoldenCaseExpected,
  actual: GoldenCaseActual,
): GoldenSuiteActualSnapshot {
  return {
    supplierName: actual.supplierName,
    amount: actual.amount,
    documentType: actual.documentType,
    outcomeStatus: actual.outcomeStatus,
    reviewStatus: deriveReviewStatus(actual),
    persistenceAction: derivePersistenceAction(actual),
    paymentDirection: "unknown",
    confidenceScore: null,
    currency: null,
    invoiceNumber: null,
    documentDate: null,
  };
}

export function compareGoldenSuiteCase(
  testCase: GoldenSuiteCase,
  actual: GoldenSuiteActualSnapshot,
): { failures: string[]; warnings: string[]; changedFields: GoldenSuiteFieldChange[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  const changedFields: GoldenSuiteFieldChange[] = [];
  const variance = testCase.allowedVariance ?? {};

  compareStrictField(testCase, "documentType", testCase.expectedDocumentType, actual.documentType, failures, changedFields);
  compareStrictField(
    testCase,
    "decisionOutcome",
    testCase.expectedDecisionOutcome,
    actual.outcomeStatus,
    failures,
    changedFields,
  );
  compareStrictField(
    testCase,
    "persistenceAction",
    testCase.expectedPersistenceAction,
    actual.persistenceAction ?? "none",
    failures,
    changedFields,
  );
  compareStrictField(
    testCase,
    "paymentDirection",
    testCase.expectedPaymentDirection,
    actual.paymentDirection ?? "unknown",
    failures,
    changedFields,
  );

  if (testCase.expectedReviewStatus != null) {
    compareStrictField(
      testCase,
      "reviewStatus",
      testCase.expectedReviewStatus,
      actual.reviewStatus ?? null,
      failures,
      changedFields,
    );
  }

  compareAmount(testCase, actual.amount, variance, failures, warnings, changedFields);
  compareSupplierName(testCase, actual.supplierName, variance, failures, warnings, changedFields);

  if (testCase.expectedFingerprint != null) {
    compareStrictField(
      testCase,
      "fingerprint",
      testCase.expectedFingerprint,
      actual.fingerprint ?? null,
      failures,
      changedFields,
    );
  }

  if (testCase.requiredConfidenceThreshold != null && actual.confidenceScore != null) {
    const delta = variance.confidenceScoreDelta ?? 0;
    if (actual.confidenceScore + delta < testCase.requiredConfidenceThreshold) {
      const reason = `confidence ${actual.confidenceScore} below threshold ${testCase.requiredConfidenceThreshold}`;
      if (delta > 0) {
        warnings.push(reason);
        changedFields.push({
          field: "confidenceScore",
          expected: testCase.requiredConfidenceThreshold,
          actual: actual.confidenceScore,
          classification: "warning",
          reason,
        });
      } else {
        failures.push(reason);
        changedFields.push({
          field: "confidenceScore",
          expected: testCase.requiredConfidenceThreshold,
          actual: actual.confidenceScore,
          classification: "failure",
          reason,
        });
      }
    }
  }

  return { failures, warnings, changedFields };
}

function compareAmount(
  testCase: GoldenSuiteCase,
  actualAmount: number | null,
  variance: GoldenAllowedVariance,
  failures: string[],
  warnings: string[],
  changedFields: GoldenSuiteFieldChange[],
): void {
  const expected = testCase.expectedAmount;
  if (expected === undefined) return;

  const isFinancial = !testCase.expectedDocumentType.includes("non_financial");
  const missingAllowed = variance.amount === true && expected == null;

  if (isFinancial && !missingAllowed) {
    if (expected === 0 && variance.amount !== true) {
      failures.push("zero amount is failure for financial documents unless allowedVariance.amount=true");
      changedFields.push({
        field: "amount",
        expected,
        actual: actualAmount,
        classification: "failure",
        reason: "zero amount rule",
      });
      return;
    }
    if ((expected == null || expected > 0) && actualAmount == null && variance.amount !== true) {
      failures.push("missing amount is failure unless explicitly allowed");
      changedFields.push({
        field: "amount",
        expected,
        actual: actualAmount,
        classification: "failure",
        reason: "missing amount rule",
      });
      return;
    }
  }

  if (expected === actualAmount) return;

  if (variance.amount === true) {
    warnings.push(`amount variance allowed: expected ${expected} got ${actualAmount}`);
    changedFields.push({
      field: "amount",
      expected,
      actual: actualAmount,
      classification: "warning",
      reason: "allowedVariance.amount",
    });
    return;
  }

  failures.push(`amount expected ${expected ?? "null"} got ${actualAmount ?? "null"}`);
  changedFields.push({
    field: "amount",
    expected,
    actual: actualAmount,
    classification: "failure",
    reason: "exact amount match required",
  });
}

function compareSupplierName(
  testCase: GoldenSuiteCase,
  actualSupplier: string | null,
  variance: GoldenAllowedVariance,
  failures: string[],
  warnings: string[],
  changedFields: GoldenSuiteFieldChange[],
): void {
  const expected = testCase.expectedSupplierName;
  if (expected === undefined) return;
  if (normalizeSupplier(expected) === normalizeSupplier(actualSupplier)) return;

  if (variance.supplierName) {
    warnings.push(`supplier normalization variance: expected "${expected}" got "${actualSupplier ?? "null"}"`);
    changedFields.push({
      field: "supplierName",
      expected,
      actual: actualSupplier,
      classification: "warning",
      reason: "allowedVariance.supplierName",
    });
    return;
  }

  failures.push(`supplierName expected "${expected}" got "${actualSupplier ?? "null"}"`);
  changedFields.push({
    field: "supplierName",
    expected,
    actual: actualSupplier,
    classification: "failure",
    reason: "supplier mismatch",
  });
}

function compareStrictField(
  testCase: GoldenSuiteCase,
  field: string,
  expected: unknown,
  actual: unknown,
  failures: string[],
  changedFields: GoldenSuiteFieldChange[],
): void {
  if (expected === actual) return;
  failures.push(`${field} expected "${String(expected)}" got "${String(actual ?? "null")}"`);
  changedFields.push({
    field,
    expected,
    actual,
    classification: "failure",
    reason: `strict field mismatch on ${testCase.caseId}`,
  });
}

function normalizeSupplier(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function deriveReviewStatus(actual: GoldenCaseActual): string {
  if (actual.outcomeStatus === "NEEDS_REVIEW") return "needs_review";
  if (actual.outcomeStatus === "BLOCKED") return "needs_review";
  if (actual.trustDecision === "AUTO_SAVE" && actual.outcomeStatus === "SAVED") return "auto_saved";
  if (
    actual.outcomeStatus === "ERROR" ||
    actual.outcomeStatus === "DUPLICATE" ||
    actual.outcomeStatus === "NOT_FINANCIAL"
  ) {
    return "rejected";
  }
  return "needs_review";
}

function derivePersistenceAction(actual: GoldenCaseActual): string {
  switch (actual.outcomeStatus) {
    case "BLOCKED":
      return "blocked";
    case "DUPLICATE":
      return "duplicate_update";
    case "NOT_FINANCIAL":
      return "not_persisted";
    case "NEEDS_REVIEW":
      return "needs_review_fdr";
    case "ERROR":
      return "rejected";
    case "SAVED":
      return actual.trustDecision === "AUTO_SAVE" ? "auto_save_payment" : "needs_review_fdr";
    default:
      return "none";
  }
}
