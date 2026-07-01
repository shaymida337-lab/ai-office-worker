/**
 * Phase 2.6 — Confidence gate types (production decision layer).
 */

export const CONFIDENCE_DECISIONS = ["AUTO_EXECUTE", "REVIEW_REQUIRED", "BLOCKED"] as const;
export type ConfidenceDecision = (typeof CONFIDENCE_DECISIONS)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low", "critical"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export type ConfidenceEvidenceItem = {
  source: string;
  score: number | null;
  weight: number;
  detail: string;
  present: boolean;
};

export type ConfidenceThresholds = {
  autoExecuteMin: number;
  reviewRequiredMin: number;
  blockedBelow: number;
};

export type ConfidenceEvaluationInput = {
  organizationId: string;
  entityType: string;
  entityId: string;
  correlationId?: string | null;

  // Core extraction signals
  confidenceScore: number | null;
  ocrConfidence: number | null;
  amount: number | null;
  amountConfidence: number | null;
  supplierName: string | null;
  supplierMatchConfidence: number | null;
  documentType: string;
  paymentDirection: string | null;
  hasAttachment: boolean;

  // Risk signals
  isDuplicateSuspicion: boolean;
  isConfirmedDuplicate: boolean;
  hasConflictingAmounts: boolean;
  missingSupplier: boolean;
  unsupportedDocument: boolean;
  corruptedDocument: boolean;
  sourceTrusted: boolean;

  // External checks
  permissionDenied: boolean;
  crossOrgMismatch: boolean;
  integrityCritical: boolean;
  integrityWarning: boolean;
  businessRuleViolations: string[];
  aiAuditorObjections: string[];

  // Historical / trust engine
  trustEngineConfidence: number | null;
  historicalConsistency: number | null;
};

export type ConfidenceResult = {
  decision: ConfidenceDecision;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  explanation: string;
  supportingEvidence: ConfidenceEvidenceItem[];
  missingEvidence: string[];
  blockingReasons: string[];
  recommendedAction: string;
  thresholds: ConfidenceThresholds;
  evaluatedAt: string;
};

export type ConfidenceApiResponse = ConfidenceResult & {
  organizationId: string;
  entityType: string;
  entityId: string;
};
