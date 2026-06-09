import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessReviewToInvoiceCandidate,
  buildGmailFinancialPersistencePlan,
  buildGmailScanDuplicateKey,
  classifyOcrSupplierText,
  classifyGmailScanCandidate,
  collectAttachmentParts,
  detectSupplierKeyword,
  extractHebrewInvoiceFieldsFromText,
  extractInvoiceAmount,
  isIncomingSupplierExpenseCandidate,
  isInvoiceImageAttachmentPart,
  normalizeOcrSupplierText,
  resolveSupplierMetadata,
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

test("collects inline jpeg image parts for OCR", () => {
  const result = collectAttachmentParts({
    mimeType: "multipart/related",
    parts: [
      {
        mimeType: "text/html",
        body: { data: Buffer.from("<img src=\"cid:invoice-photo\">").toString("base64") },
      },
      {
        mimeType: "image/jpeg",
        filename: "",
        body: { attachmentId: "att-inline-photo" },
        headers: [
          { name: "Content-Disposition", value: "inline" },
          { name: "Content-ID", value: "<invoice-photo>" },
        ],
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].mimeType, "image/jpeg");
  assert.equal(result[0].body?.attachmentId, "att-inline-photo");
});

test("recursively collects image parts nested under mixed alternative related payloads", () => {
  const result = collectAttachmentParts({
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("invoice attached").toString("base64url") } },
          {
            mimeType: "multipart/related",
            parts: [
              { mimeType: "text/html", body: { data: Buffer.from("<img src=\"cid:nested-invoice\">").toString("base64url") } },
              {
                mimeType: "application/octet-stream",
                filename: "IMG_2042.JPG",
                body: { attachmentId: "att-nested-photo" },
                headers: [
                  { name: "Content-Disposition", value: "inline; filename=\"IMG_2042.JPG\"" },
                  { name: "Content-ID", value: "<nested-invoice>" },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].body?.attachmentId, "att-nested-photo");
  assert.equal(isInvoiceImageAttachmentPart(result[0]), true);
});

test("detects inline CID image data without attachmentId", () => {
  const result = collectAttachmentParts({
    mimeType: "multipart/related",
    parts: [
      { mimeType: "text/html", body: { data: Buffer.from("<img src=\"cid:inline-photo\">").toString("base64url") } },
      {
        mimeType: "image/png",
        filename: "",
        body: { data: Buffer.from("png-bytes").toString("base64url") },
        headers: [
          { name: "Content-Disposition", value: "inline" },
          { name: "Content-ID", value: "<inline-photo>" },
        ],
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].mimeType, "image/png");
  assert.equal(isInvoiceImageAttachmentPart(result[0]), true);
});

test("detects HEIC image attachments by MIME and generic filename", () => {
  const byMime = collectAttachmentParts({
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "image/heic",
        filename: "",
        body: { attachmentId: "att-heic-mime" },
        headers: [{ name: "Content-Disposition", value: "attachment" }],
      },
    ],
  });
  const byFilename = collectAttachmentParts({
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "application/octet-stream",
        filename: "IMG_3001.HEIF",
        body: { attachmentId: "att-heif-name" },
      },
    ],
  });

  assert.equal(isInvoiceImageAttachmentPart(byMime[0]), true);
  assert.equal(isInvoiceImageAttachmentPart(byFilename[0]), true);
});

test("holds photographed invoice image with uncertain OCR for review", () => {
  const result = classifyGmailScanCandidate({
    subject: "Photo from phone",
    bodyText: "filename=photo.jpg documentType=invoice supplier=Acme Ltd amount=unknown invoiceNumber=INV-44 currency=ILS paymentRequired=true",
    attachmentFilenames: ["photo.jpg"],
    analysis: analysis({ documentType: "invoice", confidence: 0.86, invoiceNumber: "INV-44" }),
    amount: null,
    supplierName: "Acme Ltd",
  });

  assert.equal(result.documentType, "invoice");
  assert.equal(result.isRelevant, true);
  assert.equal(result.reviewStatus, "needs_review");
  assert.match(result.decisionReason, /no valid amount/);
  assert.equal(result.audit.imageInvoiceDetected, true);
});

test("detects חברת החשמל from Hebrew OCR text", () => {
  const text = "צילום חשבון חברת החשמל לישראל מספר חשבון 123456 סכום לתשלום 418.90 ש״ח";
  const result = detectSupplierKeyword(text);

  assert.equal(result?.supplierName, "חברת החשמל");
  assert.equal(result?.confidence, 0.99);
});

test("detects requested Hebrew suppliers from OCR keywords", () => {
  const cases = [
    ["תאגיד מי-רמת-גן חשבון מים תקופתי", "מי רמת גן"],
    ["חיוב ארנונה עירוני לתשלום", "ארנונה"],
    ["חשבונית בזק בינלאומי עבור אינטרנט", "בזק"],
    ["חשבונית הוט מובייל עבור שירותי תקשורת", "הוט"],
    ["סלקום חשבונית חודשית", "סלקום"],
    ["פלאפון חשבון חודשי", "פלאפון"],
    ["yes חשבונית חודשית עבור טלוויזיה", "yes"],
    ["max פירוט חיובי כרטיס אשראי", "max"],
    ["ישרא כרט פירוט עסקאות", "ישראכרט"],
    ["תחנת פז קבלה עבור דלק", "פז"],
    ["דור אלון חשבונית דלק", "דור אלון"],
    ["Wolt receipt total paid", "Wolt"],
  ] as const;

  for (const [text, expectedSupplier] of cases) {
    const result = detectSupplierKeyword(text);
    assert.equal(result?.supplierName, expectedSupplier);
    assert.ok((result?.confidence ?? 0) >= 0.97);
  }
});

test("detects noisy spaced Hebrew OCR supplier keywords", () => {
  const result = detectSupplierKeyword("צילום חשבון מ י   ר מ ת   ג ן מספר צרכן 123 סכום לתשלום");

  assert.equal(result?.supplierName, "מי רמת גן");
  assert.equal(result?.confidence, 0.99);
});

test("normalizes noisy OCR text before supplier classification", () => {
  const normalized = normalizeOcrSupplierText("חֶבְרַת\nהחשמל !!!  MAX\tפירוט-חיוב");
  const result = classifyOcrSupplierText("תשלום עבור דור\nאלון; מסמך 123");

  assert.equal(normalized, "חברת החשמל max פירוט חיוב");
  assert.equal(result?.supplierName, "דור אלון");
  assert.equal(result?.keyword.replace(/\s+/g, ""), "דוראלון");
});

test("resolves חברת החשמל supplier from OCR before unknown fallback", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "לא ידוע",
    analysisSupplierTaxId: null,
    bodyText: "--- VISUAL ATTACHMENT ANALYSIS ---\nrawOcrText=חברת החשמל סכום לתשלום 418.90 מספר חשבון 123456",
    senderName: "Unknown",
    senderEmail: "photo-scan@gmail.com",
    senderDomain: "gmail.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.name, "חברת החשמל");
  assert.equal(supplier.source, "keyword");
  assert.equal(supplier.confidence, 0.99);
});

test("resolves requested keyword suppliers before unknown fallback", () => {
  const cases = [
    ["subject: חשבון מי רמת גן\nbody empty", "מי רמת גן"],
    ["--- PDF ATTACHMENT TEXT ---\nהולילנד חשבונית מס קבלה", "הולילנד"],
    ["--- VISUAL ATTACHMENT ANALYSIS ---\nrawOcrText=סופר פארם סכום 78.40", "סופר פארם"],
    ["email body says wolt payment receipt", "Wolt"],
  ] as const;

  for (const [bodyText, expectedSupplier] of cases) {
    const supplier = resolveSupplierMetadata({
      analysisSupplier: "Unknown",
      analysisSupplierTaxId: null,
      bodyText,
      senderName: "Unknown",
      senderEmail: "photo-scan@gmail.com",
      senderDomain: "gmail.com",
      ownerEmails: new Set(["owner@example.com"]),
      knownSupplierNames: new Map(),
    });

    assert.equal(supplier.name, expectedSupplier);
    assert.equal(supplier.source, "keyword");
    assert.notEqual(supplier.name, "Unknown supplier");
  }
});

test("keeps low-confidence חברת החשמל image invoice in needs review with supplier", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "Unknown",
    analysisSupplierTaxId: null,
    bodyText: "filename=photo.jpg documentType=invoice rawOcrText=חברת החשמל סכום לתשלום 418.90 מספר חשבון 123456",
    senderName: "Unknown",
    senderEmail: "photo-scan@gmail.com",
    senderDomain: "gmail.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });
  const classification = classifyGmailScanCandidate({
    subject: "Photo from phone",
    bodyText: "filename=photo.jpg documentType=invoice rawOcrText=חברת החשמל מספר חשבון 123456 amount=unknown",
    attachmentFilenames: ["photo.jpg"],
    analysis: analysis({ documentType: "invoice", confidence: 0.52 }),
    amount: null,
    supplierName: supplier.name,
  });

  assert.equal(supplier.name, "חברת החשמל");
  assert.equal(classification.documentType, "invoice");
  assert.equal(classification.reviewStatus, "needs_review");
  assert.equal(classification.isRelevant, true);
});

test("keeps image-only needs-review invoice out of financial persistence", () => {
  const classification = classifyGmailScanCandidate({
    subject: "IMG_3001",
    bodyText: "filename=IMG_3001.HEIC documentType=invoice amount=unknown invoiceNumber=unknown imageOcrUnavailable=true unsupportedMime=image/heic",
    attachmentFilenames: ["IMG_3001.HEIC"],
    analysis: analysis({ documentType: "invoice", confidence: 0.55 }),
    amount: null,
    supplierName: "Unknown",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: false,
    classification,
    canPersistFinancialRecord: false,
    clientId: null,
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.documentType, "invoice");
  assert.equal(classification.reviewStatus, "needs_review");
  assert.equal(classification.audit.imageInvoiceDetected, true);
  assert.equal(plan.shouldSaveInvoice, false);
  assert.equal(plan.shouldEnsureInvoiceClient, false);
});

test("keeps invoice candidate when business classifier cannot determine money direction", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-1004",
    bodyText: "Please find attached invoice for 900 ILS",
    attachmentFilenames: ["invoice-1004.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 900, confidence: 0.93 }),
    amount: 900,
    supplierName: "Acme Ltd",
  });

  const result = applyBusinessReviewToInvoiceCandidate({
    classification,
    invoiceDetected: true,
    analysisDocumentType: "invoice",
    pipelineAction: "NEEDS_REVIEW",
    businessClassification: {
      direction: "UNSURE",
      party: "NONE",
      isRealSupplier: "UNSURE",
      decision: "NEEDS_REVIEW",
      reason: "money_direction_unsure",
    },
  });

  assert.equal(result.documentType, "invoice");
  assert.equal(result.isRelevant, true);
  assert.equal(result.reviewStatus, "needs_review");
  assert.equal(result.confidence, classification.confidence);
  assert.match(result.decisionReason, /money_direction_unsure/);
});

test("does not promote non-invoice classifier review into invoice candidate", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Team lunch",
    bodyText: "Are you free tomorrow?",
    attachmentFilenames: [],
    analysis: analysis({ confidence: 0.2 }),
    amount: null,
    supplierName: "Unknown",
  });

  const result = applyBusinessReviewToInvoiceCandidate({
    classification,
    invoiceDetected: false,
    analysisDocumentType: "other",
    pipelineAction: "NEEDS_REVIEW",
    businessClassification: {
      direction: "UNSURE",
      party: "NONE",
      isRealSupplier: "UNSURE",
      decision: "NEEDS_REVIEW",
      reason: "money_direction_unsure",
    },
  });

  assert.equal(result, classification);
  assert.equal(result.isRelevant, false);
});

test("does not treat invoice reference number as amount", () => {
  const result = extractInvoiceAmount("Fwd: חשבונית מס שריון 12151474");

  assert.equal(result.amount, null);
});

test("extracts Hebrew OCR invoice amount, number and dates", () => {
  const result = extractHebrewInvoiceFieldsFromText(`
    חברת החשמל
    מספר חשבון: 123456789
    סה"כ לתשלום ₪ 1,110.90
    תאריך 01/06/2026
    מועד תשלום 15/06/2026
  `);

  assert.equal(result.amount, 1110.9);
  assert.equal(result.invoiceNumber, "123456789");
  assert.equal(result.invoiceDate, "2026-06-01");
  assert.equal(result.dueDate, "2026-06-15");
  assert.ok(result.confidence >= 0.9);
});

test("extracts Hebrew amount without shekel symbol", () => {
  const result = extractHebrewInvoiceFieldsFromText("סכום לתשלום 412.25 תאריך 09.06.2026");

  assert.equal(result.amount, 412.25);
  assert.equal(result.invoiceDate, "2026-06-09");
});

test("rejects generic invoice number placeholders", () => {
  const result = extractHebrewInvoiceFieldsFromText("Invoice Number סהכ לתשלום 88.20");

  assert.equal(result.invoiceNumber, null);
  assert.equal(result.amount, 88.2);
});

test("returns null fields when extraction fails", () => {
  const result = extractHebrewInvoiceFieldsFromText("צילום מטושטש ללא שדות ברורים");

  assert.equal(result.amount, null);
  assert.equal(result.invoiceNumber, null);
  assert.equal(result.invoiceDate, null);
  assert.equal(result.dueDate, null);
  assert.match(result.reasons.join(","), /amount_not_found/);
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

test("allows needs-review invoice SupplierPayment with missing amount and supplier", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice photo",
    bodyText: "Attached invoice image",
    attachmentFilenames: ["invoice-photo.jpg"],
    analysis: analysis({ documentType: "invoice", confidence: 0.55 }),
    amount: null,
    supplierName: "Unknown supplier",
  });
  const paymentEligibility = supplierPaymentCreationEligibility({
    classification,
    amount: null,
    supplierName: "Unknown supplier",
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: true,
    classification,
    canPersistFinancialRecord: true,
    clientId: null,
    supplierPaymentAllowed: paymentEligibility.allowed,
  });

  assert.equal(classification.documentType, "invoice");
  assert.equal(classification.reviewStatus, "needs_review");
  assert.equal(paymentEligibility.allowed, true);
  assert.equal(paymentEligibility.persistAsNeedsReview, true);
  assert.equal(plan.supplierPaymentsToCreateOrUpdate, 1);
});

test("detected OCR supplier keeps SupplierPayment plan on supplier instead of unknown fallback", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "Unknown",
    analysisSupplierTaxId: null,
    bodyText: "--- VISUAL ATTACHMENT ANALYSIS ---\nrawOcrText=max פירוט חיובי כרטיס אשראי amount=unknown",
    senderName: "Unknown",
    senderEmail: "scan@gmail.com",
    senderDomain: "gmail.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });
  const classification = classifyGmailScanCandidate({
    subject: "Credit card statement",
    bodyText: "max פירוט חיובי כרטיס אשראי amount=unknown",
    attachmentFilenames: ["statement.jpg"],
    analysis: analysis({ documentType: "invoice", confidence: 0.56 }),
    amount: null,
    supplierName: supplier.name,
  });
  const paymentEligibility = supplierPaymentCreationEligibility({
    classification,
    amount: null,
    supplierName: supplier.name,
  });
  const plan = buildGmailFinancialPersistencePlan({
    isIncomingSupplierExpense: true,
    classification,
    canPersistFinancialRecord: true,
    clientId: null,
    supplierPaymentAllowed: paymentEligibility.allowed,
  });

  assert.equal(supplier.name, "max");
  assert.equal(supplier.source, "keyword");
  assert.equal(classification.reviewStatus, "needs_review");
  assert.doesNotMatch(classification.decisionReason, /unknown supplier/i);
  assert.equal(paymentEligibility.allowed, true);
  assert.equal(paymentEligibility.persistAsNeedsReview, true);
  assert.equal(plan.supplierPaymentsToCreateOrUpdate, 1);
});

test("keeps non invoice needs-review SupplierPayment blocked", () => {
  const classification = classifyGmailScanCandidate({
    subject: "General update",
    bodyText: "Please review the attached document later.",
    attachmentFilenames: [],
    analysis: analysis({ documentType: "other", confidence: 0.4 }),
    amount: null,
    supplierName: "Unknown supplier",
  });
  const paymentEligibility = supplierPaymentCreationEligibility({
    classification,
    amount: null,
    supplierName: "Unknown supplier",
  });

  assert.equal(paymentEligibility.allowed, false);
  assert.match(paymentEligibility.reasons.join(","), /document_type_/);
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

test("does not create analysis tasks before review approval", () => {
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
    clientId: "client-1",
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.reviewStatus, "needs_review");
  assert.equal(plan.shouldCreateAnalysisTasks, false);
});

test("creates analysis tasks after review gate passes", () => {
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
    clientId: "client-1",
    supplierPaymentAllowed: false,
  });

  assert.equal(classification.reviewStatus, "auto_saved");
  assert.equal(plan.shouldCreateAnalysisTasks, true);
});
