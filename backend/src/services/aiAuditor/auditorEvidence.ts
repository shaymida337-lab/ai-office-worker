import type { AuditorEvidenceItem, AuditorEvaluationInput } from "./auditorTypes.js";

export function buildAuditorEvidence(input: AuditorEvaluationInput): {
  supportingEvidence: AuditorEvidenceItem[];
  conflictingEvidence: AuditorEvidenceItem[];
} {
  const supportingEvidence: AuditorEvidenceItem[] = [];
  const conflictingEvidence: AuditorEvidenceItem[] = [];

  const checks: Array<{
    field: string;
    primary: unknown;
    independent: unknown;
    source: string;
    confidence: number | null;
  }> = [
    {
      field: "supplier",
      primary: input.primary.supplierName,
      independent: input.independent.supplierName,
      source: "independent_extraction",
      confidence: input.independent.confidenceScore,
    },
    {
      field: "amount",
      primary: input.primary.amount,
      independent: input.independent.amount,
      source: "arc_fse_reconciliation",
      confidence: input.independent.confidenceScore,
    },
    {
      field: "invoice_number",
      primary: input.primary.invoiceNumber,
      independent: input.independent.invoiceNumber,
      source: "independent_extraction",
      confidence: null,
    },
    {
      field: "document_type",
      primary: input.primary.documentType,
      independent: input.independent.documentType,
      source: "classification_engine",
      confidence: null,
    },
    {
      field: "payment_direction",
      primary: input.primary.paymentDirection,
      independent: input.independent.paymentDirection,
      source: "direction_inference",
      confidence: null,
    },
    {
      field: "confidence",
      primary: input.primary.confidenceScore,
      independent: input.independent.confidenceScore,
      source: "confidence_reconciliation",
      confidence: input.independent.confidenceScore,
    },
  ];

  for (const check of checks) {
    const item: AuditorEvidenceItem = {
      field: check.field,
      value: check.independent,
      source: check.source,
      confidence: check.confidence,
    };
    if (valuesEqual(check.primary, check.independent, check.field) || check.independent == null) {
      if (check.independent != null) supportingEvidence.push(item);
    } else {
      conflictingEvidence.push(item);
    }
  }

  if (input.primary.isDuplicate === input.independent.isDuplicate) {
    supportingEvidence.push({
      field: "duplicate",
      value: input.independent.isDuplicate,
      source: "duplicate_gate",
      confidence: input.independent.isDuplicate ? 0.95 : 0.8,
    });
  } else {
    conflictingEvidence.push({
      field: "duplicate",
      value: input.independent.isDuplicate,
      source: "duplicate_gate",
      confidence: 0.9,
    });
  }

  if (input.primary.isFinancial === input.independent.isFinancial) {
    supportingEvidence.push({
      field: "financial_classification",
      value: input.independent.isFinancial,
      source: "document_classifier",
      confidence: 0.85,
    });
  } else {
    conflictingEvidence.push({
      field: "financial_classification",
      value: input.independent.isFinancial,
      source: "document_classifier",
      confidence: 0.9,
    });
  }

  return { supportingEvidence, conflictingEvidence };
}

function valuesEqual(a: unknown, b: unknown, field?: string): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    const tolerance = field === "confidence" ? 0.1 : field === "amount" ? 0.02 : 0.001;
    const base = Math.max(Math.abs(a), Math.abs(b), 1);
    return field === "amount" ? Math.abs(a - b) / base <= tolerance : Math.abs(a - b) <= tolerance;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return false;
}
