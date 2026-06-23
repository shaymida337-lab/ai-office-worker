import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { DocumentOutcomeStatus } from "../outcome/outcomeTypes.js";
import type { TrustDecisionKind } from "../trust/trustTypes.js";
import {
  minimizeRawOcrText,
  SANITIZED_INVOICE,
  SANITIZED_TAX_ID,
  sanitizeFreeText,
  sanitizeJsonValue,
  sanitizeSupplierLabel,
} from "./goldenSanitizer.js";
import type {
  GoldenAmountCandidateFixture,
  GoldenCase,
  GoldenCaseExpected,
  GoldenCaseInput,
  GoldenChannel,
  GoldenFingerprintFixture,
  GoldenLanguage,
  GoldenSupplierCandidateFixture,
} from "./goldenTypes.js";
import { GOLDEN_VERSION } from "./goldenTypes.js";

export const GOLDEN_STAGING_ORG_ID = "org-golden-staging" as const;

export const DEFAULT_GOLDEN_STAGING_DIR = join(__dirname, "fixtures", ".staging");

export type GoldenSourceTable = "GmailScanItem" | "FinancialDocumentReview" | "SupplierPayment";

export type GoldenParsedFieldsJson = {
  amount?: number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  confidence?: number | null;
  reasons?: string[];
  arc?: ParsedArcSummary | null;
  sir?: ParsedSirSummary | null;
  fse?: ParsedFseSummary | null;
  trust?: ParsedTrustSummary | null;
  outcome?: ParsedOutcomeSummary | null;
  rawOcrText?: string | null;
};

export type ParsedArcSummary = {
  selectedAmount?: number | null;
  currency?: string | null;
  status?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
  candidates?: Array<{
    value: number;
    kind: string;
    source: string;
    label?: string | null;
    confidence?: number | null;
  }>;
};

export type ParsedSirSummary = {
  supplierName?: string | null;
  canonicalSupplier?: string | null;
  normalizedName?: string | null;
  vatNumber?: string | null;
  status?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
};

export type ParsedFseSummary = {
  overallStatus?: string | null;
  recommendation?: string | null;
  explanation?: string | null;
};

export type ParsedTrustSummary = {
  decision?: TrustDecisionKind | string | null;
  reasonCode?: string | null;
};

export type ParsedOutcomeSummary = {
  status?: DocumentOutcomeStatus | string | null;
  reason?: string | null;
  reasonCode?: string | null;
  recommendedAction?: string | null;
};

export type GoldenSourceRecord = {
  id: string;
  sourceTable: GoldenSourceTable;
  organizationId?: string | null;
  documentType: string;
  supplierName?: string | null;
  amount?: number | null;
  currency?: string | null;
  parsedFieldsJson?: GoldenParsedFieldsJson | null;
  decisionReason?: string | null;
  reviewStatus?: string | null;
  source?: string | null;
  createdAt?: string | Date | null;
  rawOcrText?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGoldenParsedFieldsJson(value: unknown): GoldenParsedFieldsJson | null {
  if (!isRecord(value)) return null;
  return value as GoldenParsedFieldsJson;
}

function normalizeDocumentType(documentType: string): string {
  const normalized = documentType.toLowerCase();
  if (normalized === "invoice") return "tax_invoice";
  return normalized;
}

function detectLanguage(input: { supplierName?: string | null; decisionReason?: string | null }): GoldenLanguage {
  const probe = `${input.supplierName ?? ""} ${input.decisionReason ?? ""}`;
  return /[\u0590-\u05FF]/.test(probe) ? "he" : "en";
}

function resolveChannel(record: GoldenSourceRecord): GoldenChannel {
  if (record.sourceTable === "GmailScanItem") return "gmail";
  if (record.sourceTable === "FinancialDocumentReview") {
    const source = record.source?.toLowerCase() ?? "gmail";
    if (source.includes("whatsapp")) return "whatsapp";
    if (source.includes("client")) return "client_gmail";
    return "gmail";
  }
  const source = record.source?.toLowerCase() ?? "gmail";
  if (source === "camera" || source === "manual") return "manual";
  if (source.includes("whatsapp")) return "whatsapp";
  return "gmail";
}

function buildStagingCaseId(record: GoldenSourceRecord): string {
  const tableToken = record.sourceTable.replace(/[^A-Za-z]/g, "").toLowerCase();
  return `gd-staging-${tableToken}-${record.id}`;
}

function buildAmountCandidates(
  parsed: GoldenParsedFieldsJson | null,
  record: GoldenSourceRecord
): GoldenAmountCandidateFixture[] {
  const arcCandidates = parsed?.arc?.candidates ?? [];
  if (arcCandidates.length > 0) {
    return arcCandidates.map((candidate) => ({
      value: candidate.value,
      kind: candidate.kind as GoldenAmountCandidateFixture["kind"],
      source: candidate.source as GoldenAmountCandidateFixture["source"],
      label: candidate.label ?? null,
      confidence: candidate.confidence ?? null,
      currency: parsed?.arc?.currency ?? record.currency ?? "ILS",
    }));
  }

  const amount = parsed?.arc?.selectedAmount ?? parsed?.amount ?? record.amount;
  if (amount == null || !Number.isFinite(amount)) return [];

  return [
    {
      value: amount,
      kind: "invoice_total",
      source: "parsed_fields_json",
      label: "extracted.amount",
      confidence: parsed?.confidence ?? 0.7,
      currency: parsed?.arc?.currency ?? record.currency ?? "ILS",
    },
  ];
}

function buildSupplierCandidates(
  parsed: GoldenParsedFieldsJson | null,
  record: GoldenSourceRecord
): GoldenSupplierCandidateFixture[] {
  const sir = parsed?.sir;
  const supplierName = sir?.canonicalSupplier ?? sir?.supplierName ?? record.supplierName;
  if (!supplierName || supplierName === "." || supplierName.toLowerCase() === "unknown") {
    return [];
  }

  const candidates: GoldenSupplierCandidateFixture[] = [
    {
      name: supplierName,
      kind: sir?.vatNumber ? "vat_registry" : "ai_extracted",
      source: sir?.vatNumber ? "registry" : "parsed_fields_json",
      vatNumber: sir?.vatNumber ?? null,
      confidence: parsed?.confidence ?? 0.8,
    },
  ];

  return candidates;
}

function buildFingerprint(
  parsed: GoldenParsedFieldsJson | null,
  record: GoldenSourceRecord,
  documentType: string
): GoldenFingerprintFixture {
  const amount = parsed?.arc?.selectedAmount ?? parsed?.amount ?? record.amount ?? null;
  const supplier = parsed?.sir?.canonicalSupplier ?? parsed?.sir?.supplierName ?? record.supplierName ?? "unknown";

  return {
    organizationId: GOLDEN_STAGING_ORG_ID,
    supplierName: supplier,
    supplierTaxId: parsed?.sir?.vatNumber ?? null,
    invoiceNumber: parsed?.invoiceNumber ?? null,
    totalAmount: amount,
    documentDate: parsed?.invoiceDate ?? null,
    documentType,
  };
}

function inferOutcomeStatus(
  parsed: GoldenParsedFieldsJson | null,
  record: GoldenSourceRecord
): DocumentOutcomeStatus {
  const stored = parsed?.outcome?.status;
  if (
    stored === "SAVED" ||
    stored === "NEEDS_REVIEW" ||
    stored === "DUPLICATE" ||
    stored === "NOT_FINANCIAL" ||
    stored === "ERROR" ||
    stored === "BLOCKED"
  ) {
    return stored;
  }

  if (record.reviewStatus === "needs_review") return "NEEDS_REVIEW";
  if (record.reviewStatus === "auto_saved") return "SAVED";
  return "NEEDS_REVIEW";
}

function deriveExpectedFlags(
  outcomeStatus: DocumentOutcomeStatus,
  trustDecision?: string | null
): Pick<GoldenCaseExpected, "shouldAutoSave" | "shouldNeedReview" | "shouldReject"> {
  const trust = trustDecision as TrustDecisionKind | null | undefined;
  const shouldReject =
    outcomeStatus === "BLOCKED" ||
    outcomeStatus === "ERROR" ||
    outcomeStatus === "DUPLICATE" ||
    outcomeStatus === "NOT_FINANCIAL";
  const shouldAutoSave = outcomeStatus === "SAVED" && trust === "AUTO_SAVE";
  const shouldNeedReview =
    outcomeStatus === "NEEDS_REVIEW" || (outcomeStatus === "SAVED" && trust === "NEEDS_REVIEW");
  return { shouldAutoSave, shouldNeedReview, shouldReject };
}

function buildExpected(record: GoldenSourceRecord, parsed: GoldenParsedFieldsJson | null): GoldenCaseExpected {
  const outcomeStatus = inferOutcomeStatus(parsed, record);
  const trustDecision = parsed?.trust?.decision ?? null;
  const flags = deriveExpectedFlags(outcomeStatus, trustDecision);

  const supplierName =
    parsed?.sir?.canonicalSupplier ?? parsed?.sir?.supplierName ?? record.supplierName ?? null;
  const amount = parsed?.arc?.selectedAmount ?? parsed?.amount ?? record.amount ?? null;
  const reason =
    parsed?.outcome?.reason ??
    parsed?.outcome?.reasonCode ??
    parsed?.trust?.reasonCode ??
    parsed?.fse?.explanation ??
    parsed?.arc?.reason ??
    record.decisionReason ??
    `Extracted from ${record.sourceTable}`;

  return {
    supplierName,
    amount,
    documentType: normalizeDocumentType(record.documentType),
    outcomeStatus,
    ...flags,
    reason,
  };
}

function buildDescription(record: GoldenSourceRecord, parsed: GoldenParsedFieldsJson | null): string {
  const outcome = parsed?.outcome?.status ?? record.reviewStatus ?? "unknown";
  return `Staging extract from ${record.sourceTable} (${record.id}) outcome=${outcome}`;
}

export function buildGoldenCaseFromRecord(record: GoldenSourceRecord): GoldenCase {
  const parsed = parseGoldenParsedFieldsJson(record.parsedFieldsJson ?? null);
  const documentType = normalizeDocumentType(record.documentType);
  const amountCandidates = buildAmountCandidates(parsed, record);
  const supplierCandidates = buildSupplierCandidates(parsed, record);
  const fingerprint = buildFingerprint(parsed, record, documentType);

  const input: GoldenCaseInput = {
    organizationId: GOLDEN_STAGING_ORG_ID,
    currency: parsed?.arc?.currency ?? record.currency ?? "ILS",
    invoiceNumber: parsed?.invoiceNumber ?? null,
    documentDate: parsed?.invoiceDate ?? null,
    dueDate: parsed?.dueDate ?? null,
    rawOcrText: record.rawOcrText ?? parsed?.rawOcrText ?? null,
    amountCandidates,
    supplierCandidates,
    fingerprint,
    outcomeContext: {
      reviewReason: record.decisionReason ?? parsed?.outcome?.reason ?? null,
      processingStage: record.sourceTable,
    },
  };

  return {
    id: buildStagingCaseId(record),
    description: buildDescription(record, parsed),
    documentType,
    channel: resolveChannel(record),
    language: detectLanguage(record),
    input,
    expected: buildExpected(record, parsed),
  };
}

export function sanitizeGoldenCase(testCase: GoldenCase): GoldenCase {
  const sanitizedInput: GoldenCaseInput = {
    ...testCase.input,
    organizationId: GOLDEN_STAGING_ORG_ID,
    invoiceNumber: testCase.input.invoiceNumber ? SANITIZED_INVOICE : null,
    rawOcrText: minimizeRawOcrText(testCase.input.rawOcrText),
    amountCandidates: testCase.input.amountCandidates.map((candidate) => ({
      ...candidate,
      label: candidate.label ? sanitizeFreeText(candidate.label) : candidate.label,
    })),
    supplierCandidates: testCase.input.supplierCandidates.map((candidate) => ({
      ...candidate,
      name: sanitizeSupplierLabel(candidate.name) ?? "[SUPPLIER]",
      vatNumber: candidate.vatNumber ? SANITIZED_TAX_ID : null,
    })),
    fingerprint: {
      ...testCase.input.fingerprint,
      organizationId: GOLDEN_STAGING_ORG_ID,
      supplierName: sanitizeSupplierLabel(testCase.input.fingerprint.supplierName) ?? "unknown",
      supplierTaxId: testCase.input.fingerprint.supplierTaxId ? SANITIZED_TAX_ID : null,
      invoiceNumber: testCase.input.fingerprint.invoiceNumber ? SANITIZED_INVOICE : null,
    },
    fseContext: testCase.input.fseContext
      ? sanitizeJsonValue({
          ...testCase.input.fseContext,
          supplierHistory: testCase.input.fseContext.supplierHistory
            ? {
                ...testCase.input.fseContext.supplierHistory,
                lastInvoiceNumber: SANITIZED_INVOICE,
                recentInvoiceNumbers: testCase.input.fseContext.supplierHistory.recentInvoiceNumbers?.map(
                  () => SANITIZED_INVOICE
                ),
              }
            : null,
        })
      : undefined,
    outcomeContext: testCase.input.outcomeContext
      ? {
          ...testCase.input.outcomeContext,
          reviewReason: sanitizeFreeText(testCase.input.outcomeContext.reviewReason),
          duplicateMatchIdentity: sanitizeFreeText(testCase.input.outcomeContext.duplicateMatchIdentity),
          pipelineError: sanitizeFreeText(testCase.input.outcomeContext.pipelineError),
        }
      : undefined,
  };

  return {
    ...testCase,
    description: sanitizeFreeText(testCase.description) ?? testCase.description,
    input: sanitizedInput,
    expected: {
      ...testCase.expected,
      supplierName: sanitizeSupplierLabel(testCase.expected.supplierName),
      reason: sanitizeFreeText(testCase.expected.reason) ?? testCase.expected.reason,
    },
  };
}

export type GoldenStagingDocument = {
  version: typeof GOLDEN_VERSION;
  extractedAt: string;
  source: {
    id: string;
    sourceTable: GoldenSourceTable;
    createdAt: string | null;
  };
  case: GoldenCase;
};

export function buildGoldenStagingDocument(record: GoldenSourceRecord): GoldenStagingDocument {
  const built = buildGoldenCaseFromRecord(record);
  const sanitized = sanitizeGoldenCase(built);
  const createdAt =
    record.createdAt instanceof Date
      ? record.createdAt.toISOString()
      : record.createdAt ?? null;

  return {
    version: GOLDEN_VERSION,
    extractedAt: new Date().toISOString(),
    source: {
      id: record.id,
      sourceTable: record.sourceTable,
      createdAt,
    },
    case: sanitized,
  };
}

export function writeGoldenStagingCase(
  stagingDocument: GoldenStagingDocument,
  outputDir: string = DEFAULT_GOLDEN_STAGING_DIR
): string {
  mkdirSync(outputDir, { recursive: true });
  const fileName = `${stagingDocument.case.id}.json`;
  const filePath = join(outputDir, fileName);
  writeFileSync(filePath, `${JSON.stringify(stagingDocument, null, 2)}\n`, "utf8");
  return filePath;
}

export function extractGoldenStagingCase(
  record: GoldenSourceRecord,
  outputDir: string = DEFAULT_GOLDEN_STAGING_DIR
): { filePath: string; document: GoldenStagingDocument } {
  const document = buildGoldenStagingDocument(record);
  const filePath = writeGoldenStagingCase(document, outputDir);
  return { filePath, document };
}
