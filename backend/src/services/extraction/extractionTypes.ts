import type { EmailAnalysis, InvoiceScanResult } from "../claude.js";

/** Technical extraction outcome — distinct from missing business fields. */
export type ExtractionOutcome =
  | "SUCCESS"
  | "PARTIAL"
  | "NO_TEXT"
  | "OCR_FAILED"
  | "UNSUPPORTED_FILE"
  | "ENCRYPTED_PDF"
  | "MALFORMED_DOCUMENT"
  | "LLM_FAILED";

export type ExtractionSource =
  | "PDF_TEXT"
  | "OCR"
  | "VISION"
  | "LLM_TEXT"
  | "STRUCTURED"
  | "EMAIL_BODY"
  | "METADATA"
  | "NOT_USED";

export type PdfTextQualityVerdict = "usable" | "insufficient" | "garbled";

export type PdfTextQualityReasonCode =
  | "EMPTY"
  | "TOO_SHORT"
  | "LOW_PRINTABLE_RATIO"
  | "LOW_ALPHANUMERIC_RATIO"
  | "REPLACEMENT_CHARACTERS"
  | "REPEATED_JUNK"
  | "NO_FINANCIAL_EVIDENCE"
  | "USABLE";

export type PdfTextQualityAssessment = {
  verdict: PdfTextQualityVerdict;
  reasonCode: PdfTextQualityReasonCode;
  charCount: number;
  printableRatio: number;
  alphanumericRatio: number;
  hasFinancialKeywordEvidence: boolean;
};

export type ExtractionPageText = {
  pageIndex: number;
  text: string;
  quality: PdfTextQualityAssessment;
};

export type ExtractionFieldEvidence = {
  field:
    | "supplier"
    | "buyer"
    | "issue_date"
    | "due_date"
    | "service_date"
    | "subtotal"
    | "vat"
    | "total"
    | "amount_due"
    | "amount_paid"
    | "currency"
    | "document_type"
    | "invoice_number";
  rawValue: string | null;
  normalizedValue: string | number | null;
  source: ExtractionSource;
  pageIndex: number | null;
  confidence: number | null;
  evidenceLabel: string | null;
};

export type ExtractionAuditSummary = {
  outcome: ExtractionOutcome;
  nativeTextUsed: boolean;
  nativeTextQuality: PdfTextQualityVerdict | null;
  nativeTextReasonCode: PdfTextQualityReasonCode | null;
  ocrUsed: boolean;
  visionUsed: boolean;
  llmTextUsed: boolean;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
  pageCount: number;
  parserError: string | null;
};

export type PdfExtractionResult = {
  text: string;
  textForAnalysis: string;
  outcome: ExtractionOutcome;
  audit: ExtractionAuditSummary;
  pages: ExtractionPageText[];
  visionScan: InvoiceScanResult | null;
  visionHintText: string | null;
};

export type EmailAnalysisEvidenceInput = {
  analysis: EmailAnalysis;
  source: ExtractionSource;
  pageIndex?: number | null;
};

export type InvoiceScanEvidenceInput = {
  scan: InvoiceScanResult;
  source: ExtractionSource;
  pageIndex?: number | null;
};

export const EXTRACTION_AUDIT_VERSION = "extraction-audit-v1" as const;
