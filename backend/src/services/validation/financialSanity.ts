import type { MoneyDecision } from "../amount/canonicalAmount.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";
import { evaluateAllSanityRules } from "./sanityRules.js";
import type {
  FinancialSanityDecision,
  FinancialSanityInput,
  SanityOverallStatus,
  SanityRuleId,
  SanityRuleResult,
} from "./sanityTypes.js";
import { FSE_VERSION } from "./sanityTypes.js";

const ERROR_PENALTY = 18;
const WARNING_PENALTY = 8;

const RULE_RECOMMENDATIONS: Record<SanityRuleId, string> = {
  vat_arithmetic: "Review subtotal, VAT, and total fields before approving this document.",
  impossible_amount: "Re-check the extracted amount; it looks implausible for a business invoice.",
  supplier_historical_range: "Confirm the supplier and amount match prior invoices from this vendor.",
  future_invoice_date: "Verify the invoice date on the original document.",
  duplicate_suspicion: "Compare this document with the suspected duplicate before saving.",
  missing_invoice_number: "Locate the invoice number on the source document or request it from the supplier.",
  currency_mismatch: "Confirm the document currency and re-run amount resolution if needed.",
  negative_invoice_validation: "Check whether this should be recorded as a credit note instead of a standard invoice.",
  credit_note_validation: "Validate credit note totals and the referenced original invoice.",
  invoice_sequence_anomaly: "Review invoice numbering for gaps, reversals, or OCR misreads.",
  ocr_suspicious_patterns: "Manually review OCR-extracted fields because the text quality looks unreliable.",
  document_type_ceiling: "Confirm this amount is correct for the document type before approving.",
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function deriveOverallStatus(
  errors: SanityRuleResult[],
  warnings: SanityRuleResult[],
  supplierDecision: SupplierDecision,
  moneyDecision: MoneyDecision
): SanityOverallStatus {
  if (errors.length > 0) return "error";
  if (supplierDecision.status === "ambiguous" || moneyDecision.status === "ambiguous") return "review";
  if (supplierDecision.status === "missing" || moneyDecision.status === "missing") return "review";
  if (warnings.length > 0) return "warning";
  return "valid";
}

function deriveConfidence(
  supplierDecision: SupplierDecision,
  moneyDecision: MoneyDecision,
  trustScore: number
): number {
  const supplierWeight = supplierDecision.confidence;
  const moneyWeight = moneyDecision.confidence;
  const blended = supplierWeight * 0.45 + moneyWeight * 0.45 + (trustScore / 100) * 0.1;
  return clampScore(blended * 100) / 100;
}

function buildExplanation(
  status: SanityOverallStatus,
  errors: SanityRuleResult[],
  warnings: SanityRuleResult[]
): string {
  if (status === "valid") {
    return "All financial sanity checks passed. The extracted document fields appear logically consistent.";
  }

  const parts: string[] = [];
  if (errors.length > 0) {
    parts.push(`${errors.length} blocking issue${errors.length === 1 ? "" : "s"}: ${errors.map((item) => item.message).join(" ")}`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${warnings.map((item) => item.message).join(" ")}`);
  }
  return parts.join(" ");
}

function buildRecommendation(
  status: SanityOverallStatus,
  errors: SanityRuleResult[],
  warnings: SanityRuleResult[]
): string {
  if (status === "valid") {
    return "Document looks financially sane. Safe to proceed to approval workflow.";
  }

  const primary = errors[0] ?? warnings[0];
  if (!primary) {
    return "Manual review is recommended before auto-saving this document.";
  }

  const ruleRecommendation = RULE_RECOMMENDATIONS[primary.ruleId];
  if (errors.length > 0) {
    return `${ruleRecommendation} Blocking rule: ${primary.ruleId.replace(/_/g, " ")}.`;
  }
  return `${ruleRecommendation} Warning rule: ${primary.ruleId.replace(/_/g, " ")}.`;
}

function computeTrustScore(ruleResults: SanityRuleResult[]): number {
  let score = 100;
  for (const result of ruleResults) {
    if (result.severity === "error") score -= ERROR_PENALTY;
    if (result.severity === "warning") score -= WARNING_PENALTY;
  }
  return clampScore(score);
}

export function summarizeFinancialSanityDecision(decision: FinancialSanityDecision) {
  return {
    version: decision.version,
    trustScore: decision.trustScore,
    overallStatus: decision.overallStatus,
    confidence: decision.confidence,
    failedRules: decision.failedRules,
    passedRules: decision.passedRules,
    recommendation: decision.recommendation,
    explanation: decision.explanation,
    warnings: decision.warnings.map(({ ruleId, message }) => ({ ruleId, message })),
    errors: decision.errors.map(({ ruleId, message }) => ({ ruleId, message })),
  };
}

export function computeFinancialSanity(input: FinancialSanityInput): FinancialSanityDecision {
  const ruleResults = evaluateAllSanityRules(input);
  const errors = ruleResults.filter((result) => result.severity === "error");
  const warnings = ruleResults.filter((result) => result.severity === "warning");
  const passedRules = ruleResults.filter((result) => result.passed).map((result) => result.ruleId);
  const failedRules = ruleResults.filter((result) => !result.passed).map((result) => result.ruleId);
  const trustScore = computeTrustScore(ruleResults);
  const overallStatus = deriveOverallStatus(errors, warnings, input.supplierDecision, input.moneyDecision);
  const confidence = deriveConfidence(input.supplierDecision, input.moneyDecision, trustScore);
  const explanation = buildExplanation(overallStatus, errors, warnings);
  const recommendation = buildRecommendation(overallStatus, errors, warnings);

  return {
    trustScore,
    overallStatus,
    warnings,
    errors,
    confidence,
    failedRules,
    passedRules,
    recommendation,
    explanation,
    version: FSE_VERSION,
    ruleResults,
  };
}
