import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFinancialDocumentFingerprint,
  buildMessageFingerprint,
  computeCanonicalFingerprint,
  matchFinancialDocuments,
  normalizeAmount,
  normalizeDocumentDate,
  normalizeInvoiceNumber,
  normalizeSupplierName,
} from "./sharedMatcher.js";

test("normalizes OCR variants consistently", () => {
  assert.equal(normalizeSupplierName(" OpenAI LLC "), "openai");
  assert.equal(normalizeInvoiceNumber("Invoice # INV-0001693 "), "1693");
  assert.equal(normalizeAmount("₪ 12,900.00"), "12900.00");
  assert.equal(normalizeDocumentDate("01/06/2026"), "2026-06-01");
});

test("same invoice with slightly different OCR output matches", () => {
  const result = matchFinancialDocuments(
    {
      organizationId: "org-1",
      supplierName: "OpenAI LLC",
      invoiceNumber: "Invoice # INV-2026-1001",
      totalAmount: "₪120.00",
      documentDate: "2026-06-01",
      documentType: "tax_invoice",
    },
    {
      organizationId: "org-1",
      supplierName: "openai ",
      invoiceNumber: "inv 2026-1001",
      totalAmount: 120,
      documentDate: "01/06/2026",
      documentType: "invoice",
    }
  );

  assert.equal(result.result, "MATCH");
  assert.match(result.reasons.join(","), /fingerprint_match|same_invoice_number_and_amount/);
});

test("cross-channel email and WhatsApp versions of same invoice match via canonical fingerprint", () => {
  const emailVersion = {
    organizationId: "org-1",
    supplierName: "Netlify Inc.",
    invoiceNumber: "NF-88991",
    totalAmount: 49,
    documentDate: "2026-06-01",
    documentType: "invoice",
  };
  const whatsAppVersion = {
    organizationId: "org-1",
    supplierName: "netlify",
    invoiceNumber: "Invoice NF 88991",
    totalAmount: "49.00 ILS",
    documentDate: "2026-06-02",
    documentType: "tax_invoice",
  };

  assert.equal(
    computeCanonicalFingerprint(emailVersion).fingerprint,
    computeCanonicalFingerprint(whatsAppVersion).fingerprint
  );
  assert.equal(matchFinancialDocuments(emailVersion, whatsAppVersion).result, "MATCH");
});

test("same file hash is a strong match", () => {
  const result = matchFinancialDocuments(
    {
      organizationId: "org-1",
      supplierName: "Anthropic",
      invoiceNumber: "A-1",
      totalAmount: 30,
      documentDate: "2026-06-01",
      fileSha256: "ABCDEF",
    },
    {
      organizationId: "org-1",
      supplierName: "Claude",
      invoiceNumber: "different",
      totalAmount: 999,
      documentDate: "2026-07-01",
      fileSha256: "abcdef",
    }
  );

  assert.equal(result.result, "MATCH");
  assert.match(result.reasons.join(","), /fingerprint_match|same_file_sha256/);
});

test("genuinely different invoices do not match", () => {
  const result = matchFinancialDocuments(
    {
      organizationId: "org-1",
      supplierName: "OpenAI",
      invoiceNumber: "INV-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
    },
    {
      organizationId: "org-1",
      supplierName: "Netlify",
      invoiceNumber: "NF-2002",
      totalAmount: 49,
      documentDate: "2026-06-05",
    }
  );

  assert.equal(result.result, "NO_MATCH");
});

test("borderline supplier amount date overlap is unsure", () => {
  const result = matchFinancialDocuments(
    {
      organizationId: "org-1",
      supplierName: "Hardware Store Ltd",
      totalAmount: 350,
      documentDate: "2026-06-01",
    },
    {
      organizationId: "org-1",
      supplierName: "hardware store",
      totalAmount: "350.00",
      documentDate: "01-06-2026",
    }
  );

  assert.equal(result.result, "UNSURE");
  assert.deepEqual(result.reasons.sort(), ["same_amount", "same_date", "same_supplier"].sort());
});

test("same invoice number with conflicting amount is unsure", () => {
  const result = matchFinancialDocuments(
    {
      organizationId: "org-1",
      supplierName: "OpenAI",
      invoiceNumber: "INV-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
    },
    {
      organizationId: "org-1",
      supplierName: "OpenAI",
      invoiceNumber: "INV-1001",
      totalAmount: 220,
      documentDate: "2026-06-03",
    }
  );

  assert.equal(result.result, "UNSURE");
  assert.match(result.reasons.join(","), /same_invoice_number/);
});

test("same supplier+amount across close dates: distinct fingerprints, UNSURE match (review not block)", () => {
  // מדיניות שלב 4: התאריך כלול במפתח — כפילות-תאריך-קרוב היא "זיהוי סביר"
  // שמנותב ל-review דרך ה-matcher, לא חסימה קשה דרך ה-unique constraint.
  const dayOne = {
    organizationId: "org-1",
    supplierName: "514812502",
    totalAmount: 354,
    documentDate: "2026-06-01",
    documentType: "receipt",
  };
  const dayTwo = {
    organizationId: "org-1",
    supplierName: "514812502",
    totalAmount: 354,
    documentDate: "2026-06-04",
    documentType: "receipt",
  };

  assert.notEqual(
    buildFinancialDocumentFingerprint(dayOne),
    buildFinancialDocumentFingerprint(dayTwo)
  );
  const match = matchFinancialDocuments(dayOne, dayTwo);
  assert.equal(match.result, "UNSURE");
  assert.match(match.reasons.join(","), /close_dates/);
});

test("identical monthly charges a month apart are NOT duplicates (legit recurring billing)", () => {
  const june = {
    organizationId: "org-1",
    supplierName: "חברת החשמל",
    totalAmount: 354,
    documentDate: "2026-06-01",
    documentType: "receipt",
  };
  const july = { ...june, documentDate: "2026-07-01" };

  assert.notEqual(
    buildFinancialDocumentFingerprint(june),
    buildFinancialDocumentFingerprint(july)
  );
  assert.equal(matchFinancialDocuments(june, july).result, "NO_MATCH");
});

test("same supplier+type without invoice number stays distinct when amounts differ", () => {
  const first = {
    organizationId: "org-1",
    supplierName: "514812502",
    totalAmount: 354,
    documentDate: "2026-06-01",
    documentType: "receipt",
  };
  const second = {
    organizationId: "org-1",
    supplierName: "514812502",
    totalAmount: 420,
    documentDate: "2026-06-01",
    documentType: "receipt",
  };

  assert.notEqual(
    buildFinancialDocumentFingerprint(first),
    buildFinancialDocumentFingerprint(second)
  );
});

test("message fingerprint uses provider id across channels when available", () => {
  const first = buildMessageFingerprint({
    organizationId: "org-1",
    channel: "gmail",
    providerMessageId: "provider-123",
    sender: "billing@example.com",
    body: "hello",
  });
  const second = buildMessageFingerprint({
    organizationId: "org-1",
    channel: "whatsapp",
    providerMessageId: "provider-123",
    sender: "another@example.com",
    body: "different body",
  });

  assert.equal(first, second);
});
