import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceFromEmailAnalysis,
  extractNativePdfText,
  extractPdfWithCascade,
  summarizeExtractionAudit,
} from "./pdfExtractionCascade.js";
import { assessPdfTextQuality } from "./pdfTextQuality.js";
import type { InvoiceScanResult } from "../claude.js";

test("Delivery 9: native PDF text extraction returns empty for invalid buffer", async () => {
  const result = await extractNativePdfText(Buffer.from("not-a-pdf"));
  assert.equal(result.text, "");
  assert.ok(result.parserError);
});

test("Delivery 9: cascade triggers vision fallback when native text is garbled", async () => {
  const mockVision: InvoiceScanResult = {
    supplier: "Scanned Vendor Ltd",
    amount: 1180,
    totalAmount: 1180,
    date: "2026-04-13",
    invoiceNumber: "INV-9",
    currency: "ILS",
    documentType: "invoice",
    ocrText: "Supplier Scanned Vendor Total 1180",
    ocrConfidence: 0.82,
  };

  const result = await extractPdfWithCascade({
    buffer: Buffer.from("%PDF-1.4 fake"),
    filename: "scan.pdf",
    analyzeInvoiceFileFn: async () => mockVision,
  });

  assert.equal(result.audit.fallbackTriggered, true);
  assert.equal(result.audit.visionUsed, true);
  assert.ok(result.visionHintText?.includes("Scanned Vendor Ltd"));
  assert.match(result.textForAnalysis, /PDF VISION FALLBACK/);
});

test("Delivery 9: usable native text skips vision fallback", async () => {
  let visionCalled = false;
  const usableText =
    "Tax Invoice\nSupplier: Vendor ABC Ltd\nIssue Date: 13/04/2026\nSubtotal: 1000\nVAT: 180\nTotal: 1180\nCurrency: ILS";

  const quality = assessPdfTextQuality(usableText);
  assert.equal(quality.verdict, "usable");

  const result = await extractPdfWithCascade({
    buffer: Buffer.from("pdf-bytes"),
    filename: "text.pdf",
    enableVisionFallback: true,
    extractNativePdfTextFn: async () => ({
      text: usableText,
      parserError: null,
      encrypted: false,
    }),
    analyzeInvoiceFileFn: async () => {
      visionCalled = true;
      return {
        supplier: "Should Not Run",
        amount: null,
        date: null,
        invoiceNumber: null,
        currency: "ILS",
      };
    },
  });

  assert.equal(visionCalled, false);
  assert.equal(result.audit.fallbackTriggered, false);
  assert.equal(result.audit.nativeTextUsed, true);
});

test("Delivery 9: money evidence preserves semantic labels", () => {
  const evidence = buildEvidenceFromEmailAnalysis({
    source: "LLM_TEXT",
    analysis: {
      supplier: "Vendor ABC Ltd",
      amount: 1180,
      amountBeforeVat: 1000,
      vatAmount: 180,
      totalAmount: 1180,
      currency: "ILS",
      documentType: "invoice",
      paymentRequired: true,
      dueDate: null,
      invoiceDate: "2026-04-13",
      invoiceNumber: "INV-1",
      tasks: [],
      confidence: 0.9,
    },
    buyerName: "Shay Business Ltd",
  });

  const byField = new Map(evidence.map((item) => [item.field, item]));
  assert.equal(byField.get("supplier")?.normalizedValue, "Vendor ABC Ltd");
  assert.equal(byField.get("buyer")?.normalizedValue, "Shay Business Ltd");
  assert.equal(byField.get("subtotal")?.evidenceLabel, "subtotal_before_vat");
  assert.equal(byField.get("vat")?.evidenceLabel, "vat_only");
  assert.equal(byField.get("total")?.evidenceLabel, "invoice_total");
});

test("Delivery 9: extraction audit summary is observability-safe (no raw OCR text)", () => {
  const summary = summarizeExtractionAudit({
    outcome: "SUCCESS",
    nativeTextUsed: true,
    nativeTextQuality: "usable",
    nativeTextReasonCode: "USABLE",
    ocrUsed: false,
    visionUsed: false,
    llmTextUsed: false,
    fallbackTriggered: false,
    fallbackReason: null,
    pageCount: 2,
    parserError: null,
  });
  assert.equal(summary.version, "extraction-audit-v1");
  assert.equal(summary.pageCount, 2);
  assert.equal(Object.keys(summary).includes("rawOcrText"), false);
});

test("Delivery 9: multi-page marked text keeps supplier on page 1 and total on page 2", async () => {
  const page1 = "Supplier: Vendor ABC Ltd\nInvoice No: 1001";
  const page2 = "VAT: 180\nTOTAL: 1180 ILS";
  const combined = `${page1}\f${page2}`;

  const result = await extractPdfWithCascade({
    buffer: Buffer.from("pdf-bytes"),
    enableVisionFallback: false,
    extractNativePdfTextFn: async () => ({
      text: combined,
      parserError: null,
      encrypted: false,
    }),
  });

  assert.match(result.textForAnalysis, /PAGE 1/);
  assert.match(result.textForAnalysis, /Vendor ABC Ltd/);
  assert.match(result.textForAnalysis, /PAGE 2/);
  assert.match(result.textForAnalysis, /TOTAL: 1180/);
  assert.equal(result.audit.pageCount, 2);
});

test("Delivery 9B: unusable native PDF + failed vision preserves OCR_FAILED and incomplete routing", async () => {
  const { assessInvoiceCompleteness } = await import("../amount/invoiceCompleteness.js");

  const result = await extractPdfWithCascade({
    buffer: Buffer.from("pdf-bytes"),
    extractNativePdfTextFn: async () => ({
      text: "���� ���� ���� ���� ���� ����",
      parserError: null,
      encrypted: false,
    }),
    analyzeInvoiceFileFn: async () => {
      throw new Error("vision unavailable");
    },
  });

  assert.equal(result.audit.fallbackTriggered, true);
  assert.equal(result.audit.outcome, "OCR_FAILED");
  assert.equal(result.visionScan, null);

  const summary = summarizeExtractionAudit(result.audit);
  assert.equal(summary.outcome, "OCR_FAILED");

  const completeness = assessInvoiceCompleteness({
    supplierName: null,
    amount: null,
    amountResolved: false,
    currency: null,
    currencyExplicit: false,
    date: null,
    documentDateExplicit: false,
    documentType: null,
    reviewStatus: "needs_review",
    parsedFieldsJson: { extraction: summary },
  });

  assert.equal(completeness.isComplete, false);
  assert.ok(completeness.missingDataReasons.length > 0);
  assert.equal(completeness.missingDataReasons.includes("חסר סכום"), true);
  assert.equal(completeness.missingDataReasons.includes("ספק לא זוהה"), true);
});
