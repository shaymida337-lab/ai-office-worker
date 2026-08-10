import assert from "node:assert/strict";
import test from "node:test";
import { computeCanonicalAmount, type AmountCandidate } from "../amount/canonicalAmount.js";
import { assessInvoiceCompleteness } from "../amount/invoiceCompleteness.js";
import { resolveCanonicalDocumentDate } from "../date/canonicalDocumentDate.js";
import { extractDeterministicInvoiceFieldsFromPdfText } from "../invoice/pdfTextInvoiceExtraction.js";
import { computeCanonicalSupplier } from "../supplier/canonicalSupplier.js";
import { buildDocumentLabelSupplierCandidate } from "../supplier/supplierCandidates.js";
import { buildEvidenceFromEmailAnalysis } from "./pdfExtractionCascade.js";

const COMPLETE_DOC = `חשבונית מס
Supplier: Vendor ABC Ltd
Issue Date: 13/04/2026
Subtotal: 1,000.00 ILS
VAT: 180.00 ILS
Total amount due 1,180.00 ILS
Currency: ILS`;

const INCOMPLETE_DOC = `חשבונית מס
Supplier: Vendor ABC Ltd
Subtotal: 1,000.00 ILS
VAT: 180.00 ILS
Total amount due 1,180.00 ILS
Currency: ILS`;

function runExtractionToCanonicalPipeline(text: string) {
  const deterministic = extractDeterministicInvoiceFieldsFromPdfText(text);
  const evidence = buildEvidenceFromEmailAnalysis({
    source: "PDF_TEXT",
    analysis: {
      supplier: deterministic.supplierName ?? "",
      amount: deterministic.totalAmount,
      totalAmount: deterministic.totalAmount,
      amountBeforeVat: null,
      vatAmount: null,
      currency: deterministic.currency ?? "ILS",
      documentType: deterministic.documentType ?? "other",
      paymentRequired: true,
      dueDate: null,
      invoiceDate: deterministic.documentDate,
      invoiceNumber: null,
      tasks: [],
      confidence: 0.9,
    },
  });

  const supplierDecision = computeCanonicalSupplier({
    organizationId: "org-integration",
    channel: "test",
    candidates: evidence
      .filter((item) => item.field === "supplier" && item.normalizedValue)
      .map((item) =>
        buildDocumentLabelSupplierCandidate({
          supplier: String(item.normalizedValue),
          confidence: item.confidence ?? 0.85,
        })
      ),
  });

  const dateDecision = resolveCanonicalDocumentDate(
    evidence
      .filter((item) => item.field === "issue_date")
      .map((item) => ({
        semanticType: "issue_date" as const,
        rawText: item.rawValue,
        normalizedValue: typeof item.normalizedValue === "string" ? item.normalizedValue : null,
        source: "pdf_text" as const,
      })),
    "issue_date"
  );

  const arcDecision = computeCanonicalAmount({
    organizationId: "org-integration",
    documentType: (deterministic.documentType === "other" ? "invoice" : deterministic.documentType) ?? "invoice",
    currency: deterministic.currency ?? "ILS",
    source: "test",
    candidates: evidence
      .filter((item) => item.field === "total" || item.field === "subtotal" || item.field === "vat")
      .map((item) => ({
        value: typeof item.normalizedValue === "number" ? item.normalizedValue : 0,
        kind:
          item.field === "total"
            ? ("invoice_total" as const)
            : item.field === "subtotal"
              ? ("subtotal_before_vat" as const)
              : ("vat_only" as const),
        source: "regex_gmail" as const,
        label: item.evidenceLabel,
        confidence: item.confidence ?? 0.85,
      }))
      .filter((candidate) => candidate.value > 0),
  });

  const documentType = deterministic.documentType === "other" ? null : deterministic.documentType;

  const completeness = assessInvoiceCompleteness({
    supplierName: supplierDecision.supplierName,
    amount: arcDecision.selectedAmount,
    amountResolved: arcDecision.status === "resolved",
    currency: deterministic.currency,
    currencyExplicit: Boolean(deterministic.currency),
    date: dateDecision.value,
    documentDateExplicit: dateDecision.status === "resolved",
    documentType,
    reviewStatus: "approved",
    confidenceScore: "high",
  });

  const destination = completeness.isComplete ? "invoices" : "completion";

  return {
    supplier: supplierDecision.supplierName,
    issueDate: dateDecision.value,
    total: arcDecision.selectedAmount,
    currency: deterministic.currency,
    documentType,
    destination,
  };
}

test("Delivery 9: extraction → canonical integration — complete document routes to invoices", () => {
  const result = runExtractionToCanonicalPipeline(COMPLETE_DOC);
  assert.equal(result.supplier, "Vendor ABC");
  assert.equal(result.issueDate, "2026-04-13");
  assert.equal(result.total, 1180);
  assert.equal(result.currency, "ILS");
  assert.equal(result.documentType, "invoice");
  assert.equal(result.destination, "invoices");
});

test("Delivery 9: extraction → canonical integration — missing date routes to completion", () => {
  const result = runExtractionToCanonicalPipeline(INCOMPLETE_DOC);
  assert.equal(result.supplier, "Vendor ABC");
  assert.equal(result.issueDate, null);
  assert.equal(result.total, 1180);
  assert.equal(result.destination, "completion");
});

test("Delivery 9: email metadata must not become issue-date evidence", () => {
  const evidence = buildEvidenceFromEmailAnalysis({
    source: "EMAIL_BODY",
    analysis: {
      supplier: "Vendor ABC Ltd",
      amount: 100,
      totalAmount: 100,
      currency: "USD",
      documentType: "invoice",
      paymentRequired: true,
      dueDate: null,
      invoiceDate: null,
      invoiceNumber: null,
      tasks: [],
      confidence: 0.8,
    },
  });

  const dateCandidates = evidence.filter((item) => item.field === "issue_date");
  assert.equal(dateCandidates.length, 0);

  const dateDecision = resolveCanonicalDocumentDate([], "issue_date");
  assert.equal(dateDecision.value, null);
  assert.notEqual(dateDecision.value, "2026-08-01");
});
