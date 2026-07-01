import type {
  AuditorConfig,
  AuditorEvaluationInput,
  AuditorEvaluationResult,
  ComparisonDifference,
  ComparisonReport,
  PrimaryDecision,
} from "./auditorTypes.js";
import { buildAuditorEvidence } from "./auditorEvidence.js";

export function detectComparisonDifferences(
  input: AuditorEvaluationInput,
  config: AuditorConfig,
): ComparisonDifference[] {
  const differences: ComparisonDifference[] = [];
  const { primary, independent } = input;

  if (!amountsWithinTolerance(primary.amount, independent.amount, config.amountTolerancePercent)) {
    differences.push({
      field: "amount",
      primaryValue: primary.amount,
      auditorValue: independent.amount,
      severity: "critical",
      message: "Amount mismatch between primary and auditor evidence",
    });
  }

  if (!suppliersMatch(primary.supplierName, independent.supplierName)) {
    differences.push({
      field: "supplier",
      primaryValue: primary.supplierName,
      auditorValue: independent.supplierName,
      severity: config.supplierMatchRequired ? "critical" : "warning",
      message: "Supplier identity disagreement",
    });
  }

  if (
    primary.invoiceNumber != null &&
    independent.invoiceNumber != null &&
    primary.invoiceNumber.trim().toLowerCase() !== independent.invoiceNumber.trim().toLowerCase()
  ) {
    differences.push({
      field: "invoice_number",
      primaryValue: primary.invoiceNumber,
      auditorValue: independent.invoiceNumber,
      severity: "warning",
      message: "Invoice number mismatch",
    });
  }

  if (
    primary.isDuplicate !== independent.isDuplicate ||
    primary.isDuplicateSuspicion !== independent.isDuplicateSuspicion
  ) {
    differences.push({
      field: "duplicate",
      primaryValue: { duplicate: primary.isDuplicate, suspicion: primary.isDuplicateSuspicion },
      auditorValue: { duplicate: independent.isDuplicate, suspicion: independent.isDuplicateSuspicion },
      severity: "critical",
      message: "Duplicate assessment disagreement",
    });
  }

  if (!confidenceWithinTolerance(primary.confidenceScore, independent.confidenceScore, config.confidenceTolerance)) {
    differences.push({
      field: "confidence",
      primaryValue: primary.confidenceScore,
      auditorValue: independent.confidenceScore,
      severity: "warning",
      message: "Confidence score disagreement",
    });
  }

  if (
    normalizeType(primary.documentType) !== normalizeType(independent.documentType ?? primary.documentType) ||
    primary.isFinancial !== independent.isFinancial
  ) {
    differences.push({
      field: "classification",
      primaryValue: { documentType: primary.documentType, isFinancial: primary.isFinancial },
      auditorValue: { documentType: independent.documentType, isFinancial: independent.isFinancial },
      severity: "critical",
      message: "Document classification disagreement",
    });
  }

  if (primary.paymentDirection && independent.paymentDirection && primary.paymentDirection !== independent.paymentDirection) {
    differences.push({
      field: "payment_direction",
      primaryValue: primary.paymentDirection,
      auditorValue: independent.paymentDirection,
      severity: "critical",
      message: "Payment direction conflict",
    });
  }

  if (primary.crossOrgMismatch) {
    differences.push({
      field: "organization",
      primaryValue: primary.organizationId,
      auditorValue: null,
      severity: "critical",
      message: "Cross-organization anomaly detected",
    });
  }

  return differences;
}

export function comparePrimaryVsAuditor(
  primary: PrimaryDecision,
  auditor: AuditorEvaluationResult,
  input: AuditorEvaluationInput,
  config: AuditorConfig,
): ComparisonReport {
  const differences = detectComparisonDifferences(input, config);

  return {
    agrees: differences.length === 0 && auditor.auditorDecision === "PASS",
    differences,
    amountMismatch: differences.some((d) => d.field === "amount"),
    supplierMismatch: differences.some((d) => d.field === "supplier"),
    invoiceMismatch: differences.some((d) => d.field === "invoice_number"),
    duplicateMismatch: differences.some((d) => d.field === "duplicate"),
    confidenceMismatch: differences.some((d) => d.field === "confidence"),
    classificationMismatch: differences.some((d) => d.field === "classification"),
    explanation:
      differences.length === 0
        ? "Primary and auditor decisions align"
        : differences.map((diff) => diff.message).join("; "),
  };
}

export function evaluateAuditorDecision(
  input: AuditorEvaluationInput,
  config: AuditorConfig,
): AuditorEvaluationResult {
  const { supportingEvidence, conflictingEvidence } = buildAuditorEvidence(input);
  const differences = detectComparisonDifferences(input, config);
  const findings: AuditorEvaluationResult["findings"] = [];

  for (const diff of differences) {
    findings.push({
      code: `${diff.field}_mismatch`,
      severity: diff.severity === "critical" ? "critical" : "warning",
      message: diff.message,
    });
  }

  if (!input.primary.paymentDirection || input.primary.paymentDirection === "unknown") {
    findings.push({ code: "unknown_payment_direction", severity: "warning", message: "Payment direction unclear" });
  }
  if ((input.primary.confidenceScore ?? 0) < 0.75) {
    findings.push({ code: "low_confidence", severity: "warning", message: "Primary confidence below review threshold" });
  }

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  let auditorDecision: AuditorEvaluationResult["auditorDecision"];
  let recommendedAction: string;
  let explanation: string;

  if (criticalCount > 0) {
    auditorDecision = "FAIL";
    recommendedAction = "Automatic execution forbidden. Escalate for manual review.";
    explanation =
      findings
        .filter((f) => f.severity === "critical")
        .map((f) => f.message)
        .join("; ") || "Critical auditor conflict detected";
  } else if (warningCount > 0) {
    auditorDecision = "WARNING";
    recommendedAction = "Decision is probably correct; manual review recommended.";
    explanation = findings.map((f) => f.message).join("; ") || "Minor auditor concerns detected";
  } else {
    auditorDecision = "PASS";
    recommendedAction = "Primary decision confirmed. No auditor concerns.";
    explanation = "All auditor checks passed";
  }

  const auditorConfidence = computeAuditorConfidence(supportingEvidence, conflictingEvidence, auditorDecision);

  return {
    auditorDecision,
    auditorConfidence,
    findings,
    supportingEvidence,
    conflictingEvidence,
    explanation,
    recommendedAction,
    evaluatedAt: new Date().toISOString(),
  };
}

function computeAuditorConfidence(
  supporting: AuditorEvaluationResult["supportingEvidence"],
  conflicting: AuditorEvaluationResult["conflictingEvidence"],
  decision: AuditorEvaluationResult["auditorDecision"],
): number {
  const supportScore =
    supporting.length === 0
      ? 0.5
      : supporting.reduce((sum, item) => sum + (item.confidence ?? 0.7), 0) / supporting.length;
  const penalty = conflicting.length * 0.15;
  const decisionPenalty = decision === "FAIL" ? 0.4 : decision === "WARNING" ? 0.15 : 0;
  return Math.round(Math.max(0, Math.min(1, supportScore - penalty - decisionPenalty)) * 1000) / 1000;
}

function amountsWithinTolerance(
  primary: number | null,
  independent: number | null,
  tolerancePercent: number,
): boolean {
  if (primary == null || independent == null) return primary === independent;
  if (primary === 0 && independent === 0) return true;
  const base = Math.max(Math.abs(primary), Math.abs(independent), 1);
  return Math.abs(primary - independent) / base <= tolerancePercent;
}

function suppliersMatch(primary: string | null, independent: string | null): boolean {
  if (!primary || !independent) return true;
  return primary.trim().toLowerCase() === independent.trim().toLowerCase();
}

function confidenceWithinTolerance(
  primary: number | null,
  independent: number | null,
  tolerance: number,
): boolean {
  if (primary == null || independent == null) return true;
  return Math.abs(primary - independent) <= tolerance;
}

function normalizeType(value: string): string {
  return value.trim().toLowerCase();
}
