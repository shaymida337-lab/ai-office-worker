import type { EmailAnalysis, InvoiceScanResult } from "../claude.js";
import { analyzeInvoiceFile } from "../claude.js";
import type {
  ExtractionAuditSummary,
  ExtractionFieldEvidence,
  ExtractionOutcome,
  ExtractionPageText,
  ExtractionSource,
  PdfExtractionResult,
} from "./extractionTypes.js";
import {
  assessPdfTextQuality,
  formatPageMarkedText,
  splitPdfTextIntoPages,
} from "./pdfTextQuality.js";

const PDF_MIME = "application/pdf";

export type ExtractNativePdfTextResult = {
  text: string;
  parserError: string | null;
  encrypted: boolean;
};

export async function extractNativePdfText(buffer: Buffer): Promise<ExtractNativePdfTextResult> {
  let parser: { getText(): Promise<{ text?: string }>; destroy(): Promise<void> } | null = null;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const parsed = await parser.getText();
    return {
      text: parsed.text?.trim() ?? "",
      parserError: null,
      encrypted: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const encrypted = /password|encrypt|encrypted|decrypt/i.test(message);
    return {
      text: "",
      parserError: message,
      encrypted,
    };
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

function buildVisionHintText(filename: string | undefined, scan: InvoiceScanResult): string {
  return [
    `filename=${filename ?? "document.pdf"}`,
    `documentType=${scan.documentType ?? "other"}`,
    `supplier=${scan.supplier}`,
    `supplierTaxId=${scan.supplierTaxId ?? "unknown"}`,
    `amount=${scan.totalAmount ?? scan.amount ?? "unknown"}`,
    `date=${scan.date ?? "unknown"}`,
    `dueDate=${scan.dueDate ?? "unknown"}`,
    `invoiceNumber=${scan.invoiceNumber ?? "unknown"}`,
    `currency=${scan.currency}`,
    `paymentRequired=${scan.paymentRequired ?? "unknown"}`,
    scan.ocrText ? `rawOcrText=${scan.ocrText.slice(0, 3000)}` : "",
    "source=pdf_vision_fallback",
  ]
    .filter(Boolean)
    .join(" ");
}

function aggregatePageQuality(pages: ExtractionPageText[]): "usable" | "insufficient" | "garbled" {
  if (pages.some((page) => page.quality.verdict === "usable")) return "usable";
  if (pages.every((page) => page.quality.verdict === "garbled")) return "garbled";
  return "insufficient";
}

function resolveOutcome(input: {
  nativeText: string;
  pageQuality: "usable" | "insufficient" | "garbled";
  visionScan: InvoiceScanResult | null;
  visionFailed: boolean;
  parserError: string | null;
  encrypted: boolean;
}): ExtractionOutcome {
  if (input.encrypted) return "ENCRYPTED_PDF";
  if (input.parserError && !input.nativeText.trim()) {
    if (/malformed|invalid pdf|corrupt/i.test(input.parserError)) return "MALFORMED_DOCUMENT";
    return "NO_TEXT";
  }
  if (input.visionFailed && input.pageQuality !== "usable") {
    return "OCR_FAILED";
  }
  if (input.pageQuality === "usable" || input.visionScan) {
    const hasVisionEvidence =
      input.visionScan &&
      (Boolean(input.visionScan.supplier?.trim()) ||
        input.visionScan.amount != null ||
        Boolean(input.visionScan.invoiceNumber?.trim()) ||
        Boolean(input.visionScan.date));
    if (input.pageQuality === "usable" || hasVisionEvidence) return "SUCCESS";
    return "PARTIAL";
  }
  if (input.nativeText.trim()) return "PARTIAL";
  return "NO_TEXT";
}

export type PdfExtractionCascadeInput = {
  buffer: Buffer;
  filename?: string;
  organizationId?: string | null;
  correlationId?: string | null;
  enableVisionFallback?: boolean;
  analyzeInvoiceFileFn?: typeof analyzeInvoiceFile;
  /** Test hook: override native PDF text extraction. */
  extractNativePdfTextFn?: typeof extractNativePdfText;
};

export async function extractPdfWithCascade(input: PdfExtractionCascadeInput): Promise<PdfExtractionResult> {
  const enableVisionFallback = input.enableVisionFallback ?? true;
  const analyzeFile = input.analyzeInvoiceFileFn ?? analyzeInvoiceFile;
  const extractNative = input.extractNativePdfTextFn ?? extractNativePdfText;

  const native = await extractNative(input.buffer);
  const pageTexts = splitPdfTextIntoPages(native.text);
  const pages: ExtractionPageText[] = pageTexts.map((text, pageIndex) => ({
    pageIndex,
    text,
    quality: assessPdfTextQuality(text),
  }));

  const pageQuality = pages.length ? aggregatePageQuality(pages) : assessPdfTextQuality(native.text).verdict;
  const usableNativeText = pageQuality === "usable";
  const markedText = pages.length
    ? formatPageMarkedText(pages.map((page) => ({ pageIndex: page.pageIndex, text: page.text })))
    : native.text.trim();

  let visionScan: InvoiceScanResult | null = null;
  let visionHintText: string | null = null;
  let visionFailed = false;
  let fallbackTriggered = false;
  let fallbackReason: string | null = null;

  const shouldFallback =
    enableVisionFallback &&
    !native.encrypted &&
    (!native.text.trim() || pageQuality !== "usable");

  if (shouldFallback) {
    fallbackTriggered = true;
    fallbackReason = !native.text.trim()
      ? "native_text_empty"
      : pages[0]?.quality.reasonCode ?? "native_text_unusable";
    try {
      visionScan = await analyzeFile({
        fileBase64: input.buffer.toString("base64"),
        mimeType: PDF_MIME,
        filename: input.filename,
        correlationId: input.correlationId,
        organizationId: input.organizationId,
      });
      visionHintText = buildVisionHintText(input.filename, visionScan);
    } catch (err) {
      visionFailed = true;
      fallbackReason = `${fallbackReason};vision_error:${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const outcome = resolveOutcome({
    nativeText: native.text,
    pageQuality,
    visionScan,
    visionFailed,
    parserError: native.parserError,
    encrypted: native.encrypted,
  });

  const audit: ExtractionAuditSummary = {
    outcome,
    nativeTextUsed: usableNativeText,
    nativeTextQuality: pages[0]?.quality.verdict ?? (native.text.trim() ? assessPdfTextQuality(native.text).verdict : null),
    nativeTextReasonCode: pages[0]?.quality.reasonCode ?? (native.text.trim() ? assessPdfTextQuality(native.text).reasonCode : null),
    ocrUsed: Boolean(visionScan?.ocrText),
    visionUsed: Boolean(visionScan),
    llmTextUsed: false,
    fallbackTriggered,
    fallbackReason,
    pageCount: Math.max(pages.length, native.text.trim() ? 1 : 0),
    parserError: native.parserError,
  };

  const textForAnalysis = [markedText, visionHintText && `--- PDF VISION FALLBACK ---\n${visionHintText}`]
    .filter(Boolean)
    .join("\n\n");

  return {
    text: native.text,
    textForAnalysis: textForAnalysis || markedText,
    outcome,
    audit,
    pages,
    visionScan,
    visionHintText,
  };
}

export function summarizeExtractionAudit(audit: ExtractionAuditSummary) {
  return {
    version: "extraction-audit-v1" as const,
    outcome: audit.outcome,
    nativeTextUsed: audit.nativeTextUsed,
    nativeTextQuality: audit.nativeTextQuality,
    nativeTextReasonCode: audit.nativeTextReasonCode,
    ocrUsed: audit.ocrUsed,
    visionUsed: audit.visionUsed,
    llmTextUsed: audit.llmTextUsed,
    fallbackTriggered: audit.fallbackTriggered,
    fallbackReason: audit.fallbackReason,
    pageCount: audit.pageCount,
    parserError: audit.parserError,
  };
}

export function buildEvidenceFromEmailAnalysis(input: {
  analysis: EmailAnalysis;
  source: ExtractionSource;
  pageIndex?: number | null;
  buyerName?: string | null;
}): ExtractionFieldEvidence[] {
  const { analysis, source, pageIndex = null, buyerName = null } = input;
  const fields: ExtractionFieldEvidence[] = [];

  const push = (
    field: ExtractionFieldEvidence["field"],
    rawValue: string | null,
    normalizedValue: string | number | null,
    evidenceLabel: string | null = null,
    confidence: number | null = analysis.confidence ?? null
  ) => {
    if (rawValue == null && normalizedValue == null) return;
    fields.push({ field, rawValue, normalizedValue, source, pageIndex, confidence, evidenceLabel });
  };

  push("supplier", analysis.supplier ?? null, analysis.supplier ?? null, "supplier");
  if (buyerName) push("buyer", buyerName, buyerName, "buyer");
  push("issue_date", analysis.invoiceDate, analysis.invoiceDate, "issue_date");
  push("due_date", analysis.dueDate, analysis.dueDate, "due_date");
  push("subtotal", analysis.amountBeforeVat != null ? String(analysis.amountBeforeVat) : null, analysis.amountBeforeVat ?? null, "subtotal_before_vat");
  push("vat", analysis.vatAmount != null ? String(analysis.vatAmount) : null, analysis.vatAmount ?? null, "vat_only");
  push("total", analysis.totalAmount != null ? String(analysis.totalAmount) : analysis.amount != null ? String(analysis.amount) : null, analysis.totalAmount ?? analysis.amount ?? null, "invoice_total");
  push("currency", analysis.currency ?? null, analysis.currency ?? null, "currency");
  push("document_type", analysis.documentType ?? null, analysis.documentType ?? null, "document_type");
  push("invoice_number", analysis.invoiceNumber ?? null, analysis.invoiceNumber ?? null, "invoice_number");

  return fields;
}

export function buildEvidenceFromInvoiceScan(input: {
  scan: InvoiceScanResult;
  source: ExtractionSource;
  pageIndex?: number | null;
}): ExtractionFieldEvidence[] {
  const emailLike: EmailAnalysis = {
    supplier: input.scan.supplier,
    supplierTaxId: input.scan.supplierTaxId ?? null,
    amount: input.scan.amount,
    amountBeforeVat: input.scan.amountBeforeVat ?? null,
    vatAmount: input.scan.vatAmount ?? null,
    totalAmount: input.scan.totalAmount ?? null,
    currency: input.scan.currency,
    documentType: input.scan.documentType ?? "other",
    paymentRequired: input.scan.paymentRequired ?? true,
    dueDate: input.scan.dueDate ?? null,
    invoiceDate: input.scan.date,
    invoiceNumber: input.scan.invoiceNumber,
    tasks: [],
    confidence: input.scan.ocrConfidence ?? 0.8,
  };
  return buildEvidenceFromEmailAnalysis({
    analysis: emailLike,
    source: input.source,
    pageIndex: input.pageIndex ?? null,
  });
}

export function mergePdfExtractionResults(results: PdfExtractionResult[]): {
  text: string;
  textForAnalysis: string;
  audits: ExtractionAuditSummary[];
  visionHintTexts: string[];
} {
  const text = results.map((result) => result.text).filter(Boolean).join("\n\n");
  const textForAnalysis = results.map((result) => result.textForAnalysis).filter(Boolean).join("\n\n");
  const visionHintTexts = results.map((result) => result.visionHintText).filter(Boolean) as string[];
  return {
    text,
    textForAnalysis,
    audits: results.map((result) => result.audit),
    visionHintTexts,
  };
}
