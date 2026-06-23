import test from "node:test";
import assert from "node:assert/strict";
import { matchWhatsAppFinancialDocumentCandidate, selectWhatsAppInvoiceAmount } from "./whatsappInvoiceIngestion.js";

test("selectWhatsAppInvoiceAmount falls back to total amount only when amount is missing", () => {
  assert.equal(selectWhatsAppInvoiceAmount({
    organizationId: "org-1",
    amount: null,
    totalAmount: 163.28,
    documentType: "invoice",
  }), 163.28);
  assert.equal(selectWhatsAppInvoiceAmount({
    organizationId: "org-1",
    amount: 200,
    totalAmount: 163.28,
    documentType: "invoice",
  }), 163.28);
  assert.equal(selectWhatsAppInvoiceAmount({
    organizationId: "org-1",
    amount: null,
    totalAmount: null,
    documentType: "invoice",
  }), null);
});

test("WhatsApp financial matcher detects same invoice from Gmail as MATCH", () => {
  const result = matchWhatsAppFinancialDocumentCandidate(
    {
      organizationId: "org-1",
      supplierName: "OpenAI LLC",
      invoiceNumber: "Invoice # INV-2026-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    {
      organizationId: "org-1",
      supplierName: "openai",
      invoiceNumber: "inv 2026-1001",
      totalAmount: 120,
      documentDate: "2026-06-02",
      documentType: "tax_invoice",
    }
  );

  assert.equal(result.result, "MATCH");
  assert.match(result.reasons.join(","), /same_invoice_number_and_amount|fingerprint_match/);
});

test("WhatsApp financial matcher lets different invoice proceed as NO_MATCH", () => {
  const result = matchWhatsAppFinancialDocumentCandidate(
    {
      organizationId: "org-1",
      supplierName: "OpenAI",
      invoiceNumber: "INV-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    {
      organizationId: "org-1",
      supplierName: "Netlify",
      invoiceNumber: "NF-2002",
      totalAmount: 49,
      documentDate: "2026-06-05",
      documentType: "invoice",
    }
  );

  assert.equal(result.result, "NO_MATCH");
});

test("WhatsApp financial matcher flags weak overlap as UNSURE", () => {
  const result = matchWhatsAppFinancialDocumentCandidate(
    {
      organizationId: "org-1",
      supplierName: "Hardware Store Ltd",
      totalAmount: 350,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    {
      organizationId: "org-1",
      supplierName: "hardware store",
      totalAmount: 350,
      documentDate: "2026-06-01",
      documentType: "invoice",
    }
  );

  assert.equal(result.result, "UNSURE");
  assert.match(result.reasons.join(","), /same_supplier/);
});
