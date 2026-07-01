/**
 * Phase 2.7 — AI Auditor production types.
 */

export const AUDITOR_OUTCOMES = ["PASS", "WARNING", "FAIL"] as const;
export type AuditorOutcome = (typeof AUDITOR_OUTCOMES)[number];

export type AuditorEvidenceItem = {
  field: string;
  value: unknown;
  source: string;
  confidence: number | null;
};

export type AuditorFindingItem = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type PrimaryDecision = {
  organizationId: string;
  entityType: string;
  entityId: string;
  correlationId: string | null;
  supplierName: string | null;
  amount: number | null;
  invoiceNumber: string | null;
  documentType: string;
  paymentDirection: string | null;
  confidenceScore: number | null;
  isFinancial: boolean;
  isDuplicate: boolean;
  isDuplicateSuspicion: boolean;
  autoExecuteRecommended: boolean;
  crossOrgMismatch: boolean;
};

export type AuditorEvaluationInput = {
  primary: PrimaryDecision;
  independent: {
    supplierName: string | null;
    amount: number | null;
    invoiceNumber: string | null;
    documentType: string | null;
    paymentDirection: string | null;
    confidenceScore: number | null;
    isFinancial: boolean;
    isDuplicate: boolean;
    isDuplicateSuspicion: boolean;
  };
};

export type AuditorEvaluationResult = {
  auditorDecision: AuditorOutcome;
  auditorConfidence: number;
  findings: AuditorFindingItem[];
  supportingEvidence: AuditorEvidenceItem[];
  conflictingEvidence: AuditorEvidenceItem[];
  explanation: string;
  recommendedAction: string;
  evaluatedAt: string;
};

export type ComparisonDifference = {
  field: string;
  primaryValue: unknown;
  auditorValue: unknown;
  severity: "warning" | "critical";
  message: string;
};

export type ComparisonReport = {
  agrees: boolean;
  differences: ComparisonDifference[];
  amountMismatch: boolean;
  supplierMismatch: boolean;
  invoiceMismatch: boolean;
  duplicateMismatch: boolean;
  confidenceMismatch: boolean;
  classificationMismatch: boolean;
  explanation: string;
};

export type AuditorFullReport = {
  primary: PrimaryDecision;
  auditor: AuditorEvaluationResult;
  comparison: ComparisonReport;
  recommendation: string;
  confidenceGateHint: {
    combinedConfidence: number | null;
    autoExecuteBlockedByAuditor: boolean;
  };
};

export type AuditorConfig = {
  enabled: boolean;
  amountTolerancePercent: number;
  confidenceTolerance: number;
  supplierMatchRequired: boolean;
};
