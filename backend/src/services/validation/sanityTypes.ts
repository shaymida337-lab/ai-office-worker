import type { MoneyDecision } from "../amount/canonicalAmount.js";
import type { CanonicalFingerprintResult } from "../dedup/sharedMatcher.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";

export const FSE_VERSION = "fse-v1" as const;

export type SanityRuleId =
  | "vat_arithmetic"
  | "impossible_amount"
  | "supplier_historical_range"
  | "future_invoice_date"
  | "duplicate_suspicion"
  | "missing_invoice_number"
  | "currency_mismatch"
  | "negative_invoice_validation"
  | "credit_note_validation"
  | "invoice_sequence_anomaly"
  | "ocr_suspicious_patterns";

export type SanityOverallStatus = "valid" | "warning" | "error" | "review";

export type SanityRuleSeverity = "pass" | "warning" | "error";

export type SanityRuleResult = {
  ruleId: SanityRuleId;
  severity: SanityRuleSeverity;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
};

export type SupplierAmountHistory = {
  invoiceCount: number;
  minAmount: number | null;
  maxAmount: number | null;
  averageAmount: number | null;
  medianAmount?: number | null;
  typicalCurrency?: string | null;
  lastInvoiceNumber?: string | null;
  recentInvoiceNumbers?: string[];
};

export type InvoiceSanityData = {
  documentType: string;
  lineItems?: Array<{ description?: string | null; amount?: number | null }>;
  rawOcrText?: string | null;
  extractionSource?: string | null;
  referencedInvoiceNumber?: string | null;
};

export type FinancialSanityContext = {
  supplierHistory?: SupplierAmountHistory | null;
  duplicateFingerprints?: string[];
  expectedCurrency?: string | null;
  referenceDate?: Date | string | null;
  vatRate?: number | null;
};

export type FinancialSanityInput = {
  organizationId: string;
  supplierDecision: SupplierDecision;
  moneyDecision: MoneyDecision;
  fingerprint: CanonicalFingerprintResult | null;
  invoiceNumber: string | null;
  documentDate: Date | string | null;
  dueDate?: Date | string | null;
  currency?: string | null;
  vatRate?: number | null;
  invoiceData: InvoiceSanityData;
  context?: FinancialSanityContext;
};

export type FinancialSanityDecision = {
  trustScore: number;
  overallStatus: SanityOverallStatus;
  warnings: SanityRuleResult[];
  errors: SanityRuleResult[];
  confidence: number;
  failedRules: SanityRuleId[];
  passedRules: SanityRuleId[];
  recommendation: string;
  explanation: string;
  version: typeof FSE_VERSION;
  ruleResults: SanityRuleResult[];
};
