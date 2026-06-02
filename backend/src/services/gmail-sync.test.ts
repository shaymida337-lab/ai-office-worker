import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGmailFinancialPersistencePlan,
  buildGmailScanDuplicateKey,
  classifyGmailScanCandidate,
  extractInvoiceAmount,
  isIncomingSupplierExpenseCandidate,
  supplierPaymentCreationEligibility,
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
  assert.equal(result.reviewStatus, "auto_saved");
  assert.match(result.decisionReason, /Auto-saved: receipt/);
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

test("does not treat invoice reference number as amount", () => {
  const result = extractInvoiceAmount("Fwd: חשבונית מס שריון 12151474");

  assert.equal(result.amount, null);
});

test("holds absurd parsed amounts for review", () => {
  const result = classifyGmailScanCandidate({
    subject: "Invoice INV-1003",
    bodyText: "Total due 17,914,063,727 ILS",
    attachmentFilenames: ["invoice-1003.pdf"],
    analysis: analysis({ documentType: "invoice", confidence: 0.9 }),
    amount: null,
    supplierName: "Acme Ltd",
    amountRejectedReason: "parsed amount looks invalid/too large",
  });

  assert.equal(result.reviewStatus, "needs_review");
  assert.match(result.decisionReason, /too large/);
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

test("holds forwarded bank notifications from gmail when bank name appears in content", () => {
  const result = classifyGmailScanCandidate({
    subject: "Fwd: בנק הפועלים - הודעה על פעולה בחשבון",
    bodyText: "הודעה מבנק הפועלים על פרעון הלוואות וביטול מסגרת. סכום לתשלום 118,188.47 ש״ח",
    attachmentFilenames: ["notice.pdf"],
    analysis: analysis({ documentType: "payment_request", paymentRequired: true, confidence: 0.95 }),
    amount: 118188.47,
    supplierName: "בנק הפועלים",
    senderName: "Forwarded mail",
    senderEmail: "someone@gmail.com",
    senderDomain: "gmail.com",
  });

  assert.equal(result.reviewStatus, "needs_review");
  assert.equal(result.heldForFinancialSender, true);
  assert.match(result.decisionReason, /financial institution detected by name/);
  assert.match(result.financialSenderReason ?? "", /בנק הפועלים/);
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
  assert.match(result.decisionReason, /payment request without attachment/);
});

test("incoming OpenAI supplier invoice persists only as SupplierPayment", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Your OpenAI invoice INV-2026-1001",
    bodyText: "Attached is your invoice. Total due 120 ILS. Please pay by the due date.",
    attachmentFilenames: ["openai-invoice-2026-1001.pdf"],
    analysis: analysis({
      supplier: "OpenAI",
      documentType: "invoice",
      paymentRequired: true,
      confidence: 0.94,
      invoiceNumber: "INV-2026-1001",
      invoiceDate: "2026-06-01",
      amount: 120,
      totalAmount: 120,
    }),
    amount: 120,
    supplierName: "OpenAI",
    senderEmail: "billing@openai.com",
    senderDomain: "openai.com",
  });
  const isSupplierExpense = isIncomingSupplierExpenseCandidate({
    source: "gmail",
    senderEmail: "billing@openai.com",
    senderDomain: "openai.com",
    supplierName: "OpenAI",
    documentType: classification.documentType,
    paymentRequired: true,
    ownerEmails: new Set(["owner@example-business.co.il"]),
  });
  const paymentEligibility = supplierPaymentCreationEligibility({
    classification,
    amount: 120,
    supplierName: "OpenAI",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: isSupplierExpense,
    classification,
    canPersistFinancialRecord: true,
    clientId: null,
    supplierPaymentAllowed: paymentEligibility.allowed,
  });

  assert.equal(classification.reviewStatus, "auto_saved");
  assert.equal(isSupplierExpense, true);
  assert.equal(paymentEligibility.allowed, true);
  assert.equal(plan.supplierPaymentsToCreateOrUpdate, 1);
  assert.equal(plan.shouldCreateClientForRelevantEmail, false);
  assert.equal(plan.shouldEnsureInvoiceClient, false);
  assert.equal(plan.shouldSaveInvoice, false);
});

test("does not create relevant-email Client before review approval", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Payment request",
    bodyText: "Please pay 740 ILS by Friday. No attachment.",
    attachmentFilenames: [],
    analysis: analysis({ documentType: "payment_request", paymentRequired: true, confidence: 0.62 }),
    amount: 740,
    supplierName: "Office Supplier",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: false,
    classification,
    canPersistFinancialRecord: false,
    clientId: null,
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.reviewStatus, "needs_review");
  assert.equal(plan.shouldCreateClientForRelevantEmail, false);
});

test("creates relevant-email Client after review gate passes", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Please find attached invoice for 1,250 ILS",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1250, confidence: 0.9 }),
    amount: 1250,
    supplierName: "Acme Ltd",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: false,
    classification,
    canPersistFinancialRecord: true,
    clientId: null,
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.reviewStatus, "auto_saved");
  assert.equal(plan.shouldCreateClientForRelevantEmail, true);
});

test("does not create lead before review approval", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Payment request",
    bodyText: "Please pay 740 ILS by Friday. No attachment.",
    attachmentFilenames: [],
    analysis: analysis({ documentType: "payment_request", paymentRequired: true, confidence: 0.62 }),
    amount: 740,
    supplierName: "Office Supplier",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: false,
    classification,
    canPersistFinancialRecord: false,
    clientId: null,
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.reviewStatus, "needs_review");
  assert.equal(plan.shouldCreateLeadForRelevantEmail, false);
});

test("creates lead after review gate passes", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Please find attached invoice for 1,250 ILS",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1250, confidence: 0.9 }),
    amount: 1250,
    supplierName: "Acme Ltd",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: false,
    classification,
    canPersistFinancialRecord: true,
    clientId: null,
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.reviewStatus, "auto_saved");
  assert.equal(plan.shouldCreateLeadForRelevantEmail, true);
});

test("does not ensure invoice Client before review approval", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-1002",
    bodyText: "Please find attached invoice.",
    attachmentFilenames: ["invoice-1002.pdf"],
    analysis: analysis({ documentType: "invoice", confidence: 0.9 }),
    amount: null,
    supplierName: "Acme Ltd",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: false,
    classification,
    canPersistFinancialRecord: false,
    clientId: null,
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.reviewStatus, "needs_review");
  assert.equal(plan.shouldEnsureInvoiceClient, false);
});

test("ensures invoice Client after review gate passes", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Please find attached invoice for 1,250 ILS",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1250, confidence: 0.9 }),
    amount: 1250,
    supplierName: "Acme Ltd",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: false,
    classification,
    canPersistFinancialRecord: true,
    clientId: null,
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.reviewStatus, "auto_saved");
  assert.equal(plan.shouldEnsureInvoiceClient, true);
});
