/**
 * Golden Test Suite v1 — design schema extending golden-v1 pipeline fixtures.
 * Scaffold only: no document processing or production DB access.
 */
import type { DocumentOutcomeStatus } from "../outcome/outcomeTypes.js";
import type { GoldenCase, GoldenChannel } from "./goldenTypes.js";

export const GOLDEN_SUITE_VERSION = "golden-suite-v1" as const;

export const GOLDEN_SOURCE_CHANNELS = [
  "gmail",
  "whatsapp",
  "manual_upload",
  "drive",
  "future",
] as const;

export type GoldenSourceChannel = (typeof GOLDEN_SOURCE_CHANNELS)[number];

export const GOLDEN_PAYMENT_DIRECTIONS = [
  "incoming_expense",
  "outgoing_invoice",
  "unknown",
  "not_applicable",
] as const;

export type GoldenPaymentDirection = (typeof GOLDEN_PAYMENT_DIRECTIONS)[number];

export const GOLDEN_PERSISTENCE_ACTIONS = [
  "none",
  "needs_review_fdr",
  "auto_save_payment",
  "auto_save_invoice",
  "blocked",
  "rejected",
  "duplicate_update",
  "not_persisted",
] as const;

export type GoldenPersistenceAction = (typeof GOLDEN_PERSISTENCE_ACTIONS)[number];

export const GOLDEN_CASE_CRITICALITIES = ["critical", "standard", "informational"] as const;

export type GoldenCaseCriticality = (typeof GOLDEN_CASE_CRITICALITIES)[number];

export const GOLDEN_SUITE_STRICT_FIELDS = [
  "documentType",
  "paymentDirection",
  "persistenceAction",
  "duplicateDetection",
  "organizationIsolation",
  "decisionOutcome",
] as const;

export type GoldenSuiteStrictField = (typeof GOLDEN_SUITE_STRICT_FIELDS)[number];

export type GoldenAllowedVariance = {
  supplierName?: boolean;
  confidenceScoreDelta?: number;
  ocrTextQuality?: boolean;
  amount?: boolean;
  metadata?: string[];
};

export type GoldenMessageMetadata = {
  subject?: string | null;
  senderEmail?: string | null;
  gmailMessageId?: string | null;
  receivedAt?: string | null;
  attachmentFilenames?: string[];
  bodySnippet?: string | null;
};

export type GoldenSuiteCase = {
  caseId: string;
  version: typeof GOLDEN_SUITE_VERSION;
  sourceChannel: GoldenSourceChannel;
  documentFileRef: string | null;
  originalMessageMetadata?: GoldenMessageMetadata | null;
  expectedSupplierName?: string | null;
  expectedAmount?: number | null;
  expectedCurrency?: string | null;
  expectedDocumentType: string;
  expectedInvoiceNumber?: string | null;
  expectedDocumentDate?: string | null;
  expectedPaymentDirection: GoldenPaymentDirection;
  expectedFingerprint?: string | null;
  expectedDecisionOutcome: DocumentOutcomeStatus | string;
  expectedReviewStatus?: string | null;
  expectedPersistenceAction: GoldenPersistenceAction;
  allowedVariance: GoldenAllowedVariance;
  requiredConfidenceThreshold?: number | null;
  criticality: GoldenCaseCriticality;
  tags: string[];
  notes?: string | null;
  pipelineCaseId?: string | null;
};

export type GoldenSuiteDataset = {
  version: typeof GOLDEN_SUITE_VERSION;
  cases: GoldenSuiteCase[];
};

export type GoldenSuiteFieldChange = {
  field: string;
  expected: unknown;
  actual: unknown;
  classification: "failure" | "warning";
  reason: string;
};

export type GoldenSuiteCaseResult = {
  caseId: string;
  criticality: GoldenCaseCriticality;
  passed: boolean;
  warnings: string[];
  failures: string[];
  changedFields: GoldenSuiteFieldChange[];
  tags: string[];
};

export type GoldenSuiteRunMode = "dry_run" | "baseline_diff";

export type GoldenSuiteRunOptions = {
  mode: GoldenSuiteRunMode;
  dryRun: true;
  baselinePath?: string | null;
  localFixturesRoot?: string;
};

export type GoldenSuiteRegressionReport = {
  schemaVersion: typeof GOLDEN_SUITE_VERSION;
  generatedAt: string;
  mode: GoldenSuiteRunMode;
  totals: {
    cases: number;
    passed: number;
    failed: number;
    warnings: number;
    criticalFailures: number;
  };
  releaseRecommendation: GoldenReleaseRecommendation;
  results: GoldenSuiteCaseResult[];
  baselineDiff?: GoldenSuiteBaselineDiff | null;
};

export type GoldenReleaseRecommendation = "pass" | "warn" | "fail";

export type GoldenSuiteBaselineDiff = {
  baselineId: string;
  newFailures: string[];
  resolvedFailures: string[];
  changedFields: Array<{ caseId: string; field: string; before: unknown; after: unknown }>;
};

export function mapSuiteChannelToGoldenChannel(
  channel: GoldenSourceChannel,
): GoldenChannel | null {
  switch (channel) {
    case "gmail":
      return "gmail";
    case "whatsapp":
      return "whatsapp";
    case "manual_upload":
      return "manual";
    case "drive":
      return "gmail";
    default:
      return null;
  }
}

export type GoldenSuitePipelineBridge = {
  suiteCase: GoldenSuiteCase;
  pipelineCase?: GoldenCase;
};
