import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadInvoiceGoldenManifest, runInvoiceGoldenFixture } from "./src/services/invoice/invoiceGoldenRunner.ts";
import { extractDeterministicInvoiceFieldsFromPdfText } from "./src/services/invoice/pdfTextInvoiceExtraction.ts";
import { assessInvoiceCompleteness } from "./src/services/amount/invoiceCompleteness.ts";
import {
  isConfidentlyNotFinancialDocument,
  resolveExtractedDocumentFinancial,
} from "./src/services/classification/financialDocumentClassification.ts";
import { normalizeFinancialDocumentType, isPaymentDocumentType } from "./src/services/financialDocuments.ts";

const manifest = loadInvoiceGoldenManifest();
const fixture = manifest.fixtures.find((f) => f.id === "en_non_financial_001")!;
const result = runInvoiceGoldenFixture(fixture);
const text = readFileSync(join("test-fixtures/invoices/golden", fixture.file), "utf8");
const extracted = extractDeterministicInvoiceFieldsFromPdfText(text);
const normalizedType = normalizeFinancialDocumentType(extracted.documentType);
const financial = resolveExtractedDocumentFinancial({
  documentType: extracted.documentType,
  supplierName: extracted.supplierName,
  totalAmount: extracted.totalAmount,
  amount: extracted.totalAmount,
  pdfText: text,
  bodyText: text,
  filename: "email-only",
});
const excluded = isConfidentlyNotFinancialDocument({
  documentType: extracted.documentType,
  supplierName: extracted.supplierName,
  totalAmount: extracted.totalAmount,
  amount: extracted.totalAmount,
  pdfText: text,
  bodyText: text,
  ocrText: text,
  filename: "email-only",
});
const completeness = assessInvoiceCompleteness({
  supplierName: extracted.supplierName,
  amount: extracted.totalAmount,
  amountResolved: extracted.totalAmount != null,
  currency: extracted.currency,
  currencyExplicit: Boolean(extracted.currency?.trim()),
  date: extracted.documentDate,
  documentDateExplicit: Boolean(extracted.documentDate),
  documentType: extracted.documentType,
  reviewStatus: "approved",
  rawReviewStatus: "approved",
  confidenceScore: "high",
  decisionReason: null,
  parsedFieldsJson: { pdfText: text },
});

console.log(
  JSON.stringify(
    {
      text,
      expected: fixture.expected,
      extracted,
      normalizedType,
      isPaymentDocumentType: isPaymentDocumentType(normalizedType),
      financial,
      excluded,
      completeness: {
        isComplete: completeness.isComplete,
        missingDataReasons: completeness.missingDataReasons,
      },
      actualDestination: result.actual.destination,
      failures: result.failures,
    },
    null,
    2
  )
);
