import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGmailScanDuplicateKey,
  classifyGmailScanCandidate,
} from "./gmail-sync.js";
import type { EmailAnalysis } from "./claude.js";

function analysis(overrides: Partial<EmailAnalysis> = {}): EmailAnalysis {
  return {
    supplier: "Acme Ltd",
    amount: null,
    currency: "ILS",
    documentType: "other",
    paymentRequired: false,
    dueDate: null,
    invoiceDate: null,
    invoiceNumber: null,
    tasks: [],
    confidence: 0.5,
    ...overrides,
  };
}

test("classifies English invoice with PDF as high confidence invoice", () => {
  const result = classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Please find attached invoice for 1,250 ILS",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1250, confidence: 0.9 }),
    amount: 1250,
    supplierName: "Acme Ltd",
  });

  assert.equal(result.documentType, "invoice");
  assert.equal(result.confidenceScore, "high");
  assert.equal(result.reviewStatus, "auto_saved");
  assert.equal(result.isRelevant, true);
  assert.match(result.decisionReason, /Auto-saved: invoice/);
});

test("classifies English receipt with PDF as receipt", () => {
  const result = classifyGmailScanCandidate({
    subject: "Receipt for payment",
    bodyText: "Paid successfully. Receipt attached.",
    attachmentFilenames: ["receipt.pdf"],
    analysis: analysis({ documentType: "receipt", confidence: 0.86 }),
    amount: 320,
    supplierName: "Stripe",
  });

  assert.equal(result.documentType, "receipt");
  assert.equal(result.confidenceScore, "high");
  assert.equal(result.reviewStatus, "needs_review");
  assert.match(result.decisionReason, /documentType is receipt/);
});

test("holds high confidence invoice without valid amount for review", () => {
  const result = classifyGmailScanCandidate({
    subject: "Invoice INV-1002",
    bodyText: "Please find attached invoice.",
    attachmentFilenames: ["invoice-1002.pdf"],
    analysis: analysis({ documentType: "invoice", confidence: 0.9 }),
    amount: null,
    supplierName: "Acme Ltd",
  });

  assert.equal(result.documentType, "invoice");
  assert.equal(result.confidenceScore, "high");
  assert.equal(result.reviewStatus, "needs_review");
  assert.match(result.decisionReason, /no valid amount/);
});

test("holds financial sender messages for review even with strong payment signals", () => {
  const result = classifyGmailScanCandidate({
    subject: "פרעון הלוואות וביטול מסגרת",
    bodyText: "מצורף מסמך עם סכום 12,500 ש״ח",
    attachmentFilenames: ["notice.pdf"],
    analysis: analysis({ documentType: "receipt", paymentRequired: true, confidence: 0.95 }),
    amount: 12500,
    supplierName: "בנק הפועלים",
    senderEmail: "yhoyariv.cohen@poalim.co.il",
    senderDomain: "poalim.co.il",
  });

  assert.equal(result.reviewStatus, "needs_review");
  assert.equal(result.heldForFinancialSender, true);
  assert.match(result.decisionReason, /financial institution/);
});

test("classifies payment request without attachment and marks for review", () => {
  const result = classifyGmailScanCandidate({
    subject: "Payment request",
    bodyText: "Please pay 740 ILS by Friday. No attachment.",
    attachmentFilenames: [],
    analysis: analysis({ documentType: "payment_request", paymentRequired: true, confidence: 0.62 }),
    amount: 740,
    supplierName: "Office Supplier",
  });

  assert.equal(result.documentType, "payment_request");
  assert.equal(result.isRelevant, true);
  assert.equal(result.reviewStatus, "needs_review");
});

test("keeps irrelevant email low confidence and not relevant", () => {
  const result = classifyGmailScanCandidate({
    subject: "Team lunch",
    bodyText: "Are you free tomorrow?",
    attachmentFilenames: [],
    analysis: analysis({ confidence: 0.2 }),
    amount: null,
    supplierName: "Unknown",
  });

  assert.equal(result.documentType, "unknown_needs_review");
  assert.equal(result.confidenceScore, "low");
  assert.equal(result.isRelevant, false);
});

test("duplicate key is stable for same Gmail message, attachment, supplier and amount", () => {
  const first = buildGmailScanDuplicateKey({
    gmailMessageId: "msg-1",
    attachmentFilename: "Invoice.PDF",
    supplierName: "Acme Ltd",
    amount: 100,
  });
  const second = buildGmailScanDuplicateKey({
    gmailMessageId: "msg-1",
    attachmentFilename: "invoice.pdf",
    supplierName: " acme ltd ",
    amount: 100,
  });

  assert.equal(first, second);
});

test("classifies Hebrew supplier payment email without attachment", () => {
  const result = classifyGmailScanCandidate({
    subject: "דרישת תשלום עבור שירותים",
    bodyText: "שלום, נא להעביר תשלום בסך 1,800 ש״ח עבור השירות החודשי.",
    attachmentFilenames: [],
    analysis: analysis({ documentType: "payment_request", paymentRequired: true, confidence: 0.7 }),
    amount: 1800,
    supplierName: "ספק שירותים",
  });

  assert.equal(result.documentType, "payment_request");
  assert.equal(result.isRelevant, true);
  assert.match(result.decisionReason, /confidence is medium/);
});
