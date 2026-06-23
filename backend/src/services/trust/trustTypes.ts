import type { MoneyDecision } from "../amount/canonicalAmount.js";
import type { CanonicalFingerprintResult } from "../dedup/sharedMatcher.js";
import type { FinancialSanityDecision } from "../validation/sanityTypes.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";

export const TE_VERSION = "te-v1" as const;

export type TrustDecisionKind = "AUTO_SAVE" | "NEEDS_REVIEW" | "BLOCK";

export type TrustEngineId = "scfc" | "arc" | "sir" | "fse" | "context";

export type TrustDuplicateRisk = "none" | "low" | "medium" | "high";

export type TrustContributor = {
  engine: TrustEngineId;
  score: number;
  weight: number;
  impact: number;
  explanation: string;
};

export type TrustSupplierHistoryContext = {
  invoiceCount?: number;
  correctionsCount?: number;
};

export type TrustOptionalContext = {
  documentType?: string;
  duplicateRisk?: TrustDuplicateRisk;
  ocrQuality?: number;
  attachmentQuality?: number;
  historicalCorrections?: number;
  supplierHistory?: TrustSupplierHistoryContext | null;
  userCorrectionRate?: number;
  previousConfidence?: number;
};

export type TrustEngineInput = {
  fingerprint: CanonicalFingerprintResult | null;
  moneyDecision: MoneyDecision;
  supplierDecision: SupplierDecision;
  fseDecision: FinancialSanityDecision;
  context?: TrustOptionalContext;
};

export type TrustDecision = {
  version: typeof TE_VERSION;
  confidence: number;
  decision: TrustDecisionKind;
  reason: string;
  reasonCode: string;
  explanation: string;
  contributors: TrustContributor[];
};

export type TrustRuleEvaluation = {
  contributors: TrustContributor[];
  uncertaintyFlags: string[];
  requestsReview: boolean;
  strongAgreement: boolean;
  criticalFailure: boolean;
};
