import test from "node:test";
import assert from "node:assert/strict";
import { matchWhatsAppFinancialDocumentCandidate } from "./whatsappInvoiceIngestion.js";

test("WhatsApp financial matcher detects same invoice from Gmail as MATCH", () => {
  const result = matchWhatsAppFinancialDocumentCandidate(
    {
      organizationId: "org-1",
      supplierName: "אין קוד בלהה בע״מ",
      invoiceNumber: "1693",
      totalAmount: 12900,
      documentDate: "2026-05-31",
      documentType: "invoice",
      fileSha256: "whatsapp-file-hash",
    },
    {
      organizationId: "org-1",
      supplierName: "אין קוד בלהה בעמ",
      invoiceNumber: "חשבונית 1693",
      totalAmount: "12900.00",
      documentDate: "31/05/2026",
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
      fileSha256: "whatsapp-file-hash",
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
      fileSha256: "whatsapp-file-hash",
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
