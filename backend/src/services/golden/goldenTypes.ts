import type { AmountCandidateKind, AmountCandidateSource } from "../amount/canonicalAmount.js";
import type { DocumentOutcomeStatus } from "../outcome/outcomeTypes.js";
import type { SupplierCandidateKind, SupplierCandidateSource } from "../supplier/supplierTypes.js";
import type { TrustDecisionKind } from "../trust/trustTypes.js";

export const GOLDEN_VERSION = "golden-v1" as const;

export type GoldenChannel = "gmail" | "whatsapp" | "client_gmail" | "manual";

export type GoldenLanguage = "he" | "en" | "mixed";

export type GoldenAmountCandidateFixture = {
  value: number;
  kind: AmountCandidateKind;
  source: AmountCandidateSource;
  label?: string | null;
  confidence?: number | null;
  currency?: string | null;
};

export type GoldenSupplierCandidateFixture = {
  name: string;
  kind: SupplierCandidateKind;
  source: SupplierCandidateSource;
  vatNumber?: string | null;
  confidence?: number | null;
};

export type GoldenFingerprintFixture = {
  organizationId: string;
  supplierName: string;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  documentDate?: string | null;
  documentType?: string | null;
};

export type GoldenFseContextFixture = {
  referenceDate?: string | null;
  expectedCurrency?: string | null;
  duplicateFingerprints?: string[];
  supplierHistory?: {
    invoiceCount: number;
    minAmount: number | null;
    maxAmount: number | null;
    averageAmount: number | null;
    typicalCurrency?: string | null;
    lastInvoiceNumber?: string | null;
    recentInvoiceNumbers?: string[];
  } | null;
};

export type GoldenOutcomeContextFixture = {
  duplicateDetected?: boolean;
  duplicateMatchIdentity?: string | null;
  reviewReason?: string | null;
  pipelineError?: string | null;
  processingStage?: string | null;
};

export type GoldenCaseInput = {
  organizationId: string;
  currency?: string;
  invoiceNumber?: string | null;
  documentDate?: string | null;
  dueDate?: string | null;
  rawOcrText?: string | null;
  amountCandidates: GoldenAmountCandidateFixture[];
  supplierCandidates: GoldenSupplierCandidateFixture[];
  fingerprint: GoldenFingerprintFixture;
  fseContext?: GoldenFseContextFixture;
  outcomeContext?: GoldenOutcomeContextFixture;
};

export type GoldenCaseExpected = {
  supplierName?: string | null;
  amount?: number | null;
  documentType?: string;
  outcomeStatus: DocumentOutcomeStatus;
  shouldAutoSave: boolean;
  shouldNeedReview: boolean;
  shouldReject: boolean;
  reason: string;
};

export type GoldenCase = {
  id: string;
  description: string;
  documentType: string;
  channel: GoldenChannel;
  language: GoldenLanguage;
  input: GoldenCaseInput;
  expected: GoldenCaseExpected;
};

export type GoldenDataset = {
  version: typeof GOLDEN_VERSION;
  cases: GoldenCase[];
};

export type GoldenCaseActual = {
  supplierName: string | null;
  amount: number | null;
  documentType: string;
  outcomeStatus: DocumentOutcomeStatus;
  trustDecision: TrustDecisionKind;
  trustReasonCode: string;
  moneyStatus: string;
  supplierStatus: string;
  fseStatus: string;
};

export type GoldenCaseResult = {
  caseId: string;
  description: string;
  passed: boolean;
  failures: string[];
  expected: GoldenCaseExpected;
  actual: GoldenCaseActual;
};

export type GoldenDatasetResult = {
  version: string;
  total: number;
  passed: number;
  failed: number;
  results: GoldenCaseResult[];
};

export type GoldenValidationIssue = {
  path: string;
  message: string;
};
