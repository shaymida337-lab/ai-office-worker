import type { MoneyDecision } from "../amount/canonicalAmount.js";
import type { CanonicalFingerprintResult } from "../dedup/sharedMatcher.js";
import type { FinancialSanityDecision } from "../validation/sanityTypes.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";
import type { TrustDecision } from "../trust/trustTypes.js";

export const OE_VERSION = "oe-v1" as const;

export type DocumentOutcomeStatus =
  | "SAVED"
  | "NEEDS_REVIEW"
  | "DUPLICATE"
  | "NOT_FINANCIAL"
  | "ERROR"
  | "BLOCKED";

export type OutcomeTimelineEngine =
  | "received"
  | "ai"
  | "scfc"
  | "arc"
  | "sir"
  | "fse"
  | "trust"
  | "outcome";

export type OutcomeTimelineStep = {
  name: string;
  status: "completed" | "warning" | "failed" | "skipped" | "pending";
  explanation: string;
  engine: OutcomeTimelineEngine;
  timestamp?: string | null;
};

export type OutcomeOptionalContext = {
  duplicateDetected?: boolean;
  duplicateMatchIdentity?: string | null;
  reviewReason?: string | null;
  userCorrection?: string | null;
  pipelineError?: string | null;
  processingStage?: string | null;
  documentType?: string | null;
};

export type OutcomeEngineInput = {
  trustDecision: TrustDecision;
  fseDecision: FinancialSanityDecision;
  supplierDecision: SupplierDecision;
  moneyDecision: MoneyDecision;
  fingerprint: CanonicalFingerprintResult | null;
  context?: OutcomeOptionalContext;
};

export type DocumentOutcome = {
  version: typeof OE_VERSION;
  status: DocumentOutcomeStatus;
  headline: string;
  description: string;
  reason: string;
  reasonCode: string;
  recommendedAction: string;
  visibleToUser: boolean;
  timeline: OutcomeTimelineStep[];
};

export type OutcomeRuleResolution = {
  status: DocumentOutcomeStatus;
  reasonCode: string;
  reason: string;
  headline: string;
  description: string;
  recommendedAction: string;
  visibleToUser: boolean;
  blockingEngine?: OutcomeTimelineEngine;
  failedStage?: string | null;
  duplicateIdentity?: string | null;
};
