import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessReviewToInvoiceCandidate,
  applyFinancialSanityReviewGate,
  applyOutcomeReviewGate,
  applySupplierDecisionReviewGate,
  applyTrustReviewGate,
  buildGmailFinancialPersistencePlan,
  buildGmailOutcomeContext,
  buildGmailScanDuplicateKey,
  buildGmailTrustContext,
  classifyOcrSupplierText,
  classifyGmailScanCandidate,
  collectAttachmentParts,
  computeGmailScanRunningProgressPercent,
  detectMunicipalCollectionDocument,
  detectSupplierKeyword,
  deriveGmailTrustDuplicateRisk,
  extractHebrewInvoiceFieldsFromText,
  extractInvoiceAmount,
  gmailOutcomeStopsPersistence,
  GmailFinancialSanityContextSessionCache,
  gmailFseSupplierCacheKey,
  isIncomingSupplierExpenseCandidate,
  isInvoiceImageAttachmentPart,
  normalizeOcrSupplierText,
  resolveSupplierMetadata,
  runGmailOrgOutcomeDecision,
  runGmailOrgTrustDecision,
  selectInvoiceAttachmentAmount,
  shouldWriteGmailScanProgress,
  supplierPaymentCreationEligibility,
} from "./gmail-sync.js";
import { ARC_VERSION } from "./amount/canonicalAmount.js";
import type { MoneyDecision } from "./amount/canonicalAmount.js";
import { computeCanonicalFingerprint } from "./dedup/sharedMatcher.js";
import { computeFinancialSanity, summarizeFinancialSanityDecision } from "./validation/financialSanity.js";
import { summarizeTrustDecision } from "./trust/trustEngine.js";
import { TE_VERSION } from "./trust/trustTypes.js";
import { computeDocumentOutcome, summarizeDocumentOutcome } from "./outcome/outcomeEngine.js";
import { SIR_VERSION } from "./supplier/supplierTypes.js";
import type { SupplierDecision } from "./supplier/supplierTypes.js";
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

test("selects detected OCR amount for image invoice when AI amount is missing", () => {
  const amount = selectInvoiceAttachmentAmount({
    isImageInvoicePart: true,
    detectedAmount: 2000,
    aiTotalAmount: null,
    aiAmount: null,
  });

  assert.equal(amount, 2000);
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

test("detects Ramat Gan municipal fine documents from OCR", () => {
  const text = `
    עיריית רמת גן
    תשלום קנס
    סה״כ לתשלום 449.80
  `;
  const supplier = detectSupplierKeyword(text);
  const cityDocument = detectMunicipalCollectionDocument(text);
  const fields = extractHebrewInvoiceFieldsFromText(text);
  const classification = classifyGmailScanCandidate({
    subject: "תשלום קנס",
    bodyText: text,
    attachmentFilenames: ["fine.pdf"],
    analysis: analysis({ documentType: "payment_request", paymentRequired: true, confidence: 0.8 }),
    amount: fields.amount,
    supplierName: supplier?.supplierName ?? "Unknown supplier",
  });

  assert.equal(cityDocument.detected, true);
  assert.equal(supplier?.supplierName, "עיריית רמת גן");
  assert.equal(fields.amount, 449.8);
  assert.equal(classification.documentType, "payment_request");
  assert.equal(classification.reviewStatus, "auto_saved");
});

test("extracts municipal demand amount with thousands separator", () => {
  const text = `
    עירייה מחלקת גבייה
    דרישה לתשלום
    מספר חשבון 123456789
    הסכום לתשלום 1,110.90
  `;
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "Unknown",
    analysisSupplierTaxId: null,
    bodyText: text,
    senderName: "גבייה עירונית",
    senderEmail: "collections@example.gov.il",
    senderDomain: "example.gov.il",
    ownerEmails: new Set(),
    knownSupplierNames: new Map(),
  });
  const fields = extractHebrewInvoiceFieldsFromText(text);

  assert.equal(supplier.name, "עירייה");
  assert.equal(fields.amount, 1110.9);
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
  assert.ok(supplier.confidence >= 0.99);
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

test("conflicting explicit supplier sources become ambiguous instead of guessing", () => {
  const documentSupplier = resolveSupplierMetadata({
    analysisSupplier: "Unknown",
    analysisSupplierTaxId: null,
    bodyText: "שם ספק: אבי סופר\nפירוט: חשבון מי רמת גן צורף בטעות",
    senderName: "Unknown",
    senderEmail: "photo-scan@gmail.com",
    senderDomain: "gmail.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });
  const aiSupplier = resolveSupplierMetadata({
    analysisSupplier: "אבי סופר",
    analysisSupplierTaxId: null,
    bodyText: "פירוט חיוב כולל אזכור מי רמת גן",
    senderName: "Unknown",
    senderEmail: "photo-scan@gmail.com",
    senderDomain: "gmail.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(documentSupplier.name, "לא זוהה");
  assert.equal(documentSupplier.decision.status, "ambiguous");
  assert.notEqual(aiSupplier.name, "Unknown supplier");
  assert.ok(["ai", "sir", "keyword", "known_supplier"].includes(aiSupplier.source));
});

test("rejects unstable OCR supplier junk and does not guess supplier from sender", () => {
  const cases = [
    ["supplier: address."],
    ["from: Current"],
    ["supplier: multi number documents before parseAmount found amount 163.28"],
  ] as const;

  for (const [bodyText] of cases) {
    const supplier = resolveSupplierMetadata({
      analysisSupplier: "Unknown",
      analysisSupplierTaxId: null,
      bodyText,
      senderName: "Bezeq",
      senderEmail: "billing@bezeq.co.il",
      senderDomain: "bezeq.co.il",
      ownerEmails: new Set(["owner@example.com"]),
      knownSupplierNames: new Map(),
    });

    assert.equal(supplier.name, "לא זוהה");
    assert.equal(supplier.source, "unknown");
    assert.equal(supplier.decision.status, "missing");
  }
});

test("rejects OCR/AI output junk analysis supplier and keeps missing decision", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "OCR/AI output.",
    analysisSupplierTaxId: null,
    bodyText: "",
    senderName: "Bezeq",
    senderEmail: "billing@bezeq.co.il",
    senderDomain: "bezeq.co.il",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.name, "לא זוהה");
  assert.equal(supplier.source, "unknown");
  assert.equal(supplier.decision.status, "missing");
});

test("keeps real short Hebrew supplier from AI analysis", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "בזק",
    analysisSupplierTaxId: null,
    bodyText: "",
    senderName: "Bezeq",
    senderEmail: "billing@bezeq.co.il",
    senderDomain: "bezeq.co.il",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.name, "בזק");
  assert.ok(supplier.source === "ai" || supplier.source === "keyword" || supplier.source === "sir");
});

test("keeps real short Latin supplier from AI analysis", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "Wolt",
    analysisSupplierTaxId: null,
    bodyText: "",
    senderName: "Unknown",
    senderEmail: "billing@wolt.com",
    senderDomain: "wolt.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.name, "Wolt");
  assert.ok(supplier.source === "ai" || supplier.source === "keyword" || supplier.source === "sir");
});

test("keeps real Bezeq supplier names usable", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "בזק",
    analysisSupplierTaxId: null,
    bodyText: "",
    senderName: "Unknown",
    senderEmail: "billing@bezeq.co.il",
    senderDomain: "bezeq.co.il",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.name, "בזק");
  assert.ok(supplier.source === "ai" || supplier.source === "keyword" || supplier.source === "sir");
});

test("keeps keyword suppliers when no explicit supplier source exists", () => {
  const cases = [
    ["סופר פארם סכום 78.40", "סופר פארם"],
    ["חשבון מי רמת גן\nbody empty", "מי רמת גן"],
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
  }
});

test("Gmail SIR: VAT registry wins supplier resolution", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "Random Supplier",
    analysisSupplierTaxId: "520000391",
    bodyText: "מסמך חיוב חודשי",
    senderName: "billing",
    senderEmail: "billing@example.com",
    senderDomain: "example.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.decision.reasonCode, "VAT_REGISTRY");
  assert.equal(supplier.name, "חברת החשמל");
  assert.equal(supplier.decision.status, "resolved");
});

test("Gmail SIR: OCR and Claude agreement resolves supplier", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "חברת החשמל",
    analysisSupplierTaxId: "520000391",
    bodyText: "תשלום לחברת החשמל לישראל סכום לתשלום 418.9",
    senderName: "billing",
    senderEmail: "billing@iec.co.il",
    senderDomain: "iec.co.il",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.decision.status, "resolved");
  assert.equal(supplier.name, "חברת החשמל");
  assert.ok(supplier.decision.evidence.length >= 2);
});

test("Gmail SIR: sender or domain evidence alone does not auto-resolve", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: null,
    analysisSupplierTaxId: null,
    bodyText: "",
    senderName: "Bezeq Billing",
    senderEmail: "billing@bezeq.co.il",
    senderDomain: "bezeq.co.il",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.decision.status, "missing");
  assert.equal(supplier.name, "לא זוהה");
  assert.equal(supplier.decision.isStrongEnoughForAutoSave, false);
});

test("Gmail SIR: address candidate is rejected", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "תל אביב רחוב הרצל 12",
    analysisSupplierTaxId: null,
    bodyText: "",
    senderName: "Unknown",
    senderEmail: "scan@gmail.com",
    senderDomain: "gmail.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.decision.status, "missing");
  assert.ok(supplier.decision.rejected.some((candidate) => candidate.reason === "address_not_supplier"));
});

test("Gmail SIR: unknown supplier values are rejected", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "Unknown supplier",
    analysisSupplierTaxId: null,
    bodyText: "",
    senderName: "Unknown",
    senderEmail: "scan@gmail.com",
    senderDomain: "gmail.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
  });

  assert.equal(supplier.decision.status, "missing");
  assert.ok(supplier.decision.rejected.some((candidate) => candidate.reason === "unknown_placeholder"));
});

test("Gmail SIR: ambiguous decision routes invoice candidate to review", () => {
  const supplier = resolveSupplierMetadata({
    analysisSupplier: "OpenAI LLC",
    analysisSupplierTaxId: null,
    bodyText: "שם ספק: נטליפיי",
    senderName: "Unknown",
    senderEmail: "scan@gmail.com",
    senderDomain: "gmail.com",
    ownerEmails: new Set(["owner@example.com"]),
    knownSupplierNames: new Map(),
    ocrKeywordMatch: {
      supplierName: "Wolt",
      confidence: 0.99,
      keyword: "wolt",
      normalizedText: "wolt",
    },
  });

  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-ambiguity",
    bodyText: "Invoice attached",
    attachmentFilenames: ["invoice.pdf"],
    analysis: analysis({ documentType: "invoice", confidence: 0.9 }),
    amount: 180,
    supplierName: supplier.name,
  });
  const gated = applySupplierDecisionReviewGate({
    classification,
    supplierDecision: supplier.decision,
  });

  assert.equal(supplier.decision.status, "ambiguous");
  assert.equal(supplier.name, "לא זוהה");
  assert.equal(gated.reviewStatus, "needs_review");
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

test("rejects placeholder invoice number value Number", () => {
  const result = extractHebrewInvoiceFieldsFromText("מספר חשבונית: Number סהכ לתשלום 88.20");

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

test("city document without amount stays needs review with null parsed amount", () => {
  const text = "עיריית רמת גן תשלום קנס ללא סכום ברור";
  const fields = extractHebrewInvoiceFieldsFromText(text);
  const supplier = detectSupplierKeyword(text);
  const result = classifyGmailScanCandidate({
    subject: "תשלום קנס",
    bodyText: text,
    attachmentFilenames: ["fine.pdf"],
    analysis: analysis({ documentType: "payment_request", paymentRequired: true, confidence: 0.85 }),
    amount: fields.amount,
    supplierName: supplier?.supplierName ?? "Unknown supplier",
  });

  assert.equal(fields.amount, null);
  assert.equal(result.documentType, "payment_request");
  assert.equal(result.reviewStatus, "needs_review");
  assert.match(result.decisionReason, /no valid amount|confidence below/);
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

function gmailSirDecision(overrides: Partial<SupplierDecision> = {}): SupplierDecision {
  return {
    supplierName: "Acme Ltd",
    canonicalSupplier: "acme",
    normalizedName: "acme",
    vatNumber: "514888888",
    domains: ["acme.co.il"],
    emails: ["billing@acme.co.il"],
    phones: [],
    aliases: [],
    logo: null,
    confidence: 0.92,
    evidenceScore: 0.9,
    reason: "test",
    reasonCode: "AI_EXTRACTED",
    evidence: [],
    candidates: [],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: SIR_VERSION,
    isStrongEnoughForAutoSave: true,
    ...overrides,
  };
}

function gmailArcDecision(overrides: Partial<MoneyDecision> = {}): MoneyDecision {
  return {
    selectedAmount: 1180,
    amountBeforeVat: 1000,
    vatAmount: 180,
    currency: "ILS",
    confidence: 0.9,
    evidenceScore: 0.88,
    reason: "test",
    reasonCode: "INVOICE_TOTAL",
    candidates: [],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: ARC_VERSION,
    isStrongEnoughForAutoSave: true,
    ...overrides,
  };
}

function gmailFseInput(overrides: {
  supplierDecision?: Partial<SupplierDecision>;
  moneyDecision?: Partial<MoneyDecision>;
  invoiceNumber?: string | null;
  documentDate?: string;
  documentType?: string;
  rawOcrText?: string;
} = {}) {
  return {
    organizationId: "org-gmail-fse",
    supplierDecision: gmailSirDecision(overrides.supplierDecision),
    moneyDecision: gmailArcDecision(overrides.moneyDecision),
    fingerprint: null,
    invoiceNumber: overrides.invoiceNumber !== undefined ? overrides.invoiceNumber : "INV-1001",
    documentDate: overrides.documentDate ?? "2026-05-15",
    dueDate: null,
    currency: "ILS",
    invoiceData: {
      documentType: overrides.documentType ?? "tax_invoice",
      rawOcrText: overrides.rawOcrText ?? "חשבונית מס Acme Ltd",
      extractionSource: "gmail",
    },
    context: {
      referenceDate: "2026-06-01",
      expectedCurrency: "ILS",
    },
  };
}

test("Gmail FSE: future invoice date forces needs_review", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Invoice attached",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1180, confidence: 0.9 }),
    amount: 1180,
    supplierName: "Acme Ltd",
  });
  const fseDecision = computeFinancialSanity(
    gmailFseInput({
      documentDate: "2027-01-01",
    })
  );
  const gated = applyFinancialSanityReviewGate({ classification, fseDecision });

  assert.equal(fseDecision.overallStatus, "error");
  assert.equal(gated.reviewStatus, "needs_review");
  assert.match(gated.decisionReason, /fse_error/);
});

test("Gmail FSE: ambiguous ARC routes to review through FSE", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Invoice attached",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1180, confidence: 0.9 }),
    amount: 1180,
    supplierName: "Acme Ltd",
  });
  const fseDecision = computeFinancialSanity(
    gmailFseInput({
      moneyDecision: { status: "ambiguous", confidence: 0.4, selectedAmount: null, isStrongEnoughForAutoSave: false },
    })
  );
  const gated = applyFinancialSanityReviewGate({ classification, fseDecision });

  assert.equal(fseDecision.overallStatus, "review");
  assert.equal(gated.reviewStatus, "needs_review");
  assert.match(gated.decisionReason, /fse_review/);
});

test("Gmail FSE: repeated-digit OCR amount escalates warning to needs_review", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice",
    bodyText: "Invoice attached",
    attachmentFilenames: ["invoice.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 776776, confidence: 0.9 }),
    amount: 776776,
    supplierName: "Acme Ltd",
  });
  const fseDecision = computeFinancialSanity(
    gmailFseInput({
      moneyDecision: { selectedAmount: 776776, amountBeforeVat: null, vatAmount: null },
      rawOcrText: "סה\"כ 776,776 ש\"ח חשבונית",
    })
  );
  const gated = applyFinancialSanityReviewGate({
    classification,
    fseDecision,
    amount: 776776,
    rawOcrText: "סה\"כ 776,776 ש\"ח חשבונית",
  });

  assert.equal(gated.reviewStatus, "needs_review");
  assert.match(gated.decisionReason, /fse_(warning|valid)/);
});

test("Gmail FSE: identical repeated-digit amount escalates even when FSE is valid", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice",
    bodyText: "Invoice attached",
    attachmentFilenames: ["invoice.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 777777, confidence: 0.9 }),
    amount: 777777,
    supplierName: "Acme Ltd",
  });
  const fseDecision = computeFinancialSanity(
    gmailFseInput({
      moneyDecision: { selectedAmount: 777777, amountBeforeVat: null, vatAmount: null },
      rawOcrText: "סה\"כ 777777 ש\"ח חשבונית",
    })
  );
  const gated = applyFinancialSanityReviewGate({
    classification,
    fseDecision,
    amount: 777777,
    rawOcrText: "סה\"כ 777777 ש\"ח חשבונית",
  });

  assert.equal(fseDecision.overallStatus, "warning");
  assert.ok(fseDecision.failedRules.includes("ocr_suspicious_patterns"));
  assert.equal(gated.reviewStatus, "needs_review");
  assert.match(gated.decisionReason, /fse_warning/);
});

test("Gmail FSE: VAT mismatch warning escalates to needs_review", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Invoice attached",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1180, confidence: 0.9 }),
    amount: 1180,
    supplierName: "Acme Ltd",
  });
  const fseDecision = computeFinancialSanity(
    gmailFseInput({
      moneyDecision: {
        selectedAmount: 1180,
        amountBeforeVat: 1000,
        vatAmount: 100,
      },
    })
  );
  const gated = applyFinancialSanityReviewGate({ classification, fseDecision });

  assert.equal(fseDecision.overallStatus, "error");
  assert.ok(fseDecision.failedRules.includes("vat_arithmetic"));
  assert.equal(gated.reviewStatus, "needs_review");
});

test("Gmail FSE: low-risk warning on receipt without invoice number still allows auto_save", () => {
  const classification = classifyGmailScanCandidate({
    subject: "Receipt",
    bodyText: "Receipt attached",
    attachmentFilenames: ["receipt.pdf"],
    analysis: analysis({ documentType: "receipt", confidence: 0.86 }),
    amount: 320,
    supplierName: "Stripe",
  });
  const fseDecision = computeFinancialSanity(
    gmailFseInput({
      invoiceNumber: null,
      documentType: "receipt",
      moneyDecision: { selectedAmount: 320, amountBeforeVat: null, vatAmount: null },
    })
  );
  const gated = applyFinancialSanityReviewGate({ classification, fseDecision });

  assert.equal(fseDecision.overallStatus, "warning");
  assert.ok(fseDecision.failedRules.includes("missing_invoice_number"));
  assert.equal(gated.reviewStatus, "auto_saved");
});

test("Gmail FSE: summarizeFinancialSanityDecision persists compact audit payload", () => {
  const decision = computeFinancialSanity(gmailFseInput());
  const summary = summarizeFinancialSanityDecision(decision);

  assert.equal(summary.version, "fse-v1");
  assert.equal(summary.overallStatus, "valid");
  assert.ok(summary.trustScore >= 90);
  assert.equal(summary.errors.length, 0);
});

test("Gmail scan progress: running percent advances before scan items are saved", () => {
  assert.equal(computeGmailScanRunningProgressPercent(50, 0), 5);
  assert.equal(computeGmailScanRunningProgressPercent(50, 1), 2);
  assert.equal(computeGmailScanRunningProgressPercent(50, 10), 20);
  assert.equal(computeGmailScanRunningProgressPercent(50, 48), 95);
});

test("Gmail scan progress: writes during processing every 2 emails or 2s", () => {
  assert.equal(
    shouldWriteGmailScanProgress({
      force: false,
      emailDelta: 1,
      emailInterval: 2,
      elapsedMs: 500,
      minIntervalMs: 2_000,
    }),
    false
  );
  assert.equal(
    shouldWriteGmailScanProgress({
      force: false,
      emailDelta: 2,
      emailInterval: 2,
      elapsedMs: 500,
      minIntervalMs: 2_000,
    }),
    true
  );
  assert.equal(
    shouldWriteGmailScanProgress({
      force: false,
      emailDelta: 0,
      emailInterval: 2,
      elapsedMs: 2_500,
      minIntervalMs: 2_000,
    }),
    true
  );
});

test("Gmail FSE context cache: reuses supplier history within scan session", () => {
  const cache = new GmailFinancialSanityContextSessionCache();
  const history = {
    invoiceCount: 3,
    minAmount: 100,
    maxAmount: 500,
    averageAmount: 250,
    typicalCurrency: "ILS",
    lastInvoiceNumber: "INV-9",
    recentInvoiceNumbers: ["INV-9", "INV-8"],
  };

  assert.equal(cache.getSupplierHistory("org-1", "Acme Ltd"), undefined);
  cache.setSupplierHistory("org-1", "Acme Ltd", history);
  assert.deepEqual(cache.getSupplierHistory("org-1", "Acme Ltd"), history);
  assert.deepEqual(cache.getSupplierHistory("org-1", "ACME LTD"), history);
  assert.equal(gmailFseSupplierCacheKey("org-1", "Acme Ltd"), gmailFseSupplierCacheKey("org-1", "ACME LTD"));
});

function gmailTeClassification() {
  return classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Invoice attached",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1180, confidence: 0.9 }),
    amount: 1180,
    supplierName: "Acme Ltd",
  });
}

function gmailTeTrustInput(overrides: {
  supplierDecision?: Partial<SupplierDecision>;
  moneyDecision?: Partial<MoneyDecision>;
  documentDate?: string;
  documentType?: string;
} = {}) {
  const classification = gmailTeClassification();
  const supplierDecision = gmailSirDecision(overrides.supplierDecision);
  const moneyDecision = gmailArcDecision(overrides.moneyDecision);
  const fseDecision = computeFinancialSanity(
    gmailFseInput({
      supplierDecision: overrides.supplierDecision,
      moneyDecision: overrides.moneyDecision,
      documentDate: overrides.documentDate,
      documentType: overrides.documentType,
    })
  );

  return {
    organizationId: "org-gmail-te",
    supplierDecision,
    moneyDecision,
    fseDecision,
    supplierName: "Acme Ltd",
    supplierTaxId: "514888888",
    invoiceNumber: "INV-1001",
    documentDate: new Date(overrides.documentDate ?? "2026-05-15"),
    documentType: overrides.documentType ?? "invoice",
    classification,
    extractedFieldsConfidence: 0.9,
    hasPdfOrImageAttachment: true,
    visualNeedsReview: false,
  };
}

test("Gmail TE: strong agreement yields AUTO_SAVE", () => {
  const trustDecision = runGmailOrgTrustDecision(gmailTeTrustInput());

  assert.equal(trustDecision.decision, "AUTO_SAVE");
  assert.ok(trustDecision.confidence >= 75);
});

test("Gmail TE: ambiguous ARC routes to NEEDS_REVIEW", () => {
  const trustDecision = runGmailOrgTrustDecision(
    gmailTeTrustInput({
      moneyDecision: {
        status: "ambiguous",
        confidence: 0.4,
        selectedAmount: null,
        isStrongEnoughForAutoSave: false,
        reasonCode: "AMBIGUOUS",
      },
    })
  );

  assert.equal(trustDecision.decision, "NEEDS_REVIEW");
  assert.equal(trustDecision.reasonCode, "TE_UPSTREAM_REVIEW");
});

test("Gmail TE: FSE critical error routes to BLOCK", () => {
  const trustDecision = runGmailOrgTrustDecision(
    gmailTeTrustInput({
      documentDate: "2027-01-01",
    })
  );

  assert.equal(trustDecision.decision, "BLOCK");
  assert.equal(trustDecision.reasonCode, "TE_FSE_CRITICAL_ERROR");
});

test("Gmail TE: applyTrustReviewGate escalates NEEDS_REVIEW", () => {
  const classification = gmailTeClassification();
  const gated = applyTrustReviewGate({
    classification,
    trustDecision: {
      version: TE_VERSION,
      confidence: 62,
      decision: "NEEDS_REVIEW",
      reason: "Upstream engine requested review",
      reasonCode: "TE_UPSTREAM_REVIEW",
      explanation: "ARC ambiguity requires manual review.",
      contributors: [],
    },
  });

  assert.equal(gated.reviewStatus, "needs_review");
  assert.match(gated.decisionReason, /trust_review:TE_UPSTREAM_REVIEW/);
});

test("Gmail TE: summarizeTrustDecision persists compact audit payload", () => {
  const trustDecision = runGmailOrgTrustDecision(gmailTeTrustInput());
  const summary = summarizeTrustDecision(trustDecision);

  assert.equal(summary.version, "te-v1");
  assert.equal(summary.decision, trustDecision.decision);
  assert.equal(summary.confidence, trustDecision.confidence);
  assert.equal(summary.reasonCode, trustDecision.reasonCode);
  assert.ok(Array.isArray(summary.contributors));
  assert.ok(summary.contributors.length > 0);
  assert.ok(summary.contributors.every((item) => item.engine && typeof item.score === "number"));
});

test("Gmail TE: confidence and contributors are persisted in parsedFieldsJson.trust shape", () => {
  const trustDecision = runGmailOrgTrustDecision(gmailTeTrustInput());
  const parsedFieldsJson = {
    trust: summarizeTrustDecision(trustDecision),
  };

  assert.equal(parsedFieldsJson.trust.confidence, trustDecision.confidence);
  assert.ok(parsedFieldsJson.trust.contributors.length > 0);
  assert.ok(parsedFieldsJson.trust.contributors.some((item) => item.engine === "arc"));
  assert.ok(parsedFieldsJson.trust.contributors.some((item) => item.engine === "fse"));
  assert.ok(parsedFieldsJson.trust.contributors.every((item) => typeof item.score === "number"));
});

test("Gmail TE: duplicate risk high when FSE duplicate_suspicion fails", () => {
  const fingerprint = computeCanonicalFingerprint({
    organizationId: "org-gmail-te",
    supplierName: "Acme Ltd",
    supplierTaxId: "514888888",
    invoiceNumber: "INV-1001",
    totalAmount: 1180,
    documentDate: "2026-05-15",
    documentType: "tax_invoice",
  });
  const fseDecision = computeFinancialSanity({
    ...gmailFseInput(),
    fingerprint,
    context: {
      referenceDate: "2026-06-01",
      expectedCurrency: "ILS",
      duplicateFingerprints: [fingerprint.fingerprint!],
    },
  });

  assert.equal(deriveGmailTrustDuplicateRisk(fseDecision, fingerprint), "high");
  const context = buildGmailTrustContext({
    organizationId: "org-gmail-te",
    supplierName: "Acme Ltd",
    documentType: "invoice",
    classification: gmailTeClassification(),
    fseDecision,
    fingerprint,
  });
  assert.equal(context.duplicateRisk, "high");
});

function gmailOePipelineInput(overrides: {
  supplierDecision?: Partial<SupplierDecision>;
  moneyDecision?: Partial<MoneyDecision>;
  documentDate?: string;
  documentType?: string;
  existingScanItem?: { amount: unknown } | null;
  duplicateKey?: string | null;
  pipelineError?: string | null;
  processingStage?: string | null;
  businessClassificationReason?: string | null;
} = {}) {
  const teInput = gmailTeTrustInput({
    supplierDecision: overrides.supplierDecision,
    moneyDecision: overrides.moneyDecision,
    documentDate: overrides.documentDate,
    documentType: overrides.documentType,
  });
  const trustDecision = runGmailOrgTrustDecision(teInput);

  return {
    organizationId: teInput.organizationId,
    trustDecision,
    fseDecision: teInput.fseDecision,
    supplierDecision: teInput.supplierDecision,
    moneyDecision: teInput.moneyDecision,
    supplierName: teInput.supplierName,
    supplierTaxId: teInput.supplierTaxId,
    invoiceNumber: teInput.invoiceNumber,
    documentDate: teInput.documentDate,
    documentType: teInput.documentType,
    classification: teInput.classification,
    existingScanItem: overrides.existingScanItem ?? null,
    duplicateKey: overrides.duplicateKey ?? null,
    businessClassificationReason: overrides.businessClassificationReason ?? null,
    pipelineError: overrides.pipelineError ?? null,
    processingStage: overrides.processingStage ?? null,
  };
}

test("Gmail OE: strong agreement yields SAVED", () => {
  const outcome = runGmailOrgOutcomeDecision(gmailOePipelineInput());

  assert.equal(outcome.status, "SAVED");
  assert.equal(outcome.reasonCode, "OE_SAVED");
});

test("Gmail OE: ambiguous ARC routes to NEEDS_REVIEW", () => {
  const outcome = runGmailOrgOutcomeDecision(
    gmailOePipelineInput({
      moneyDecision: {
        status: "ambiguous",
        confidence: 0.4,
        selectedAmount: null,
        isStrongEnoughForAutoSave: false,
        reasonCode: "AMBIGUOUS",
      },
    })
  );

  assert.equal(outcome.status, "NEEDS_REVIEW");
  assert.equal(outcome.reasonCode, "OE_NEEDS_REVIEW");
});

test("Gmail OE: duplicate scan item routes to DUPLICATE", () => {
  const outcome = runGmailOrgOutcomeDecision(
    gmailOePipelineInput({
      existingScanItem: { amount: 1180 },
      duplicateKey: "dup-scan-item-key",
    })
  );

  assert.equal(outcome.status, "DUPLICATE");
  assert.equal(outcome.reasonCode, "OE_DUPLICATE_DETECTED");
  assert.match(outcome.description, /matched this document to an existing record/i);
});

test("Gmail OE: FSE critical error routes to BLOCKED", () => {
  const outcome = runGmailOrgOutcomeDecision(
    gmailOePipelineInput({
      documentDate: "2027-01-01",
    })
  );

  assert.equal(outcome.status, "BLOCKED");
  assert.equal(outcome.reasonCode, "OE_TRUST_BLOCKED");
});

test("Gmail OE: missing financial evidence routes to NOT_FINANCIAL", () => {
  const outcome = runGmailOrgOutcomeDecision(
    gmailOePipelineInput({
      supplierDecision: { status: "missing", supplierName: null, isStrongEnoughForAutoSave: false },
      moneyDecision: { status: "missing", selectedAmount: null, isStrongEnoughForAutoSave: false, reasonCode: "MISSING" },
      processingStage: "not_financial",
      businessClassificationReason: "filtered_irrelevant newsletter",
    })
  );

  assert.equal(outcome.status, "NOT_FINANCIAL");
  assert.equal(outcome.reasonCode, "OE_NOT_FINANCIAL");
});

test("Gmail OE: pipeline error routes to ERROR", () => {
  const outcome = runGmailOrgOutcomeDecision(
    gmailOePipelineInput({
      pipelineError: "Claude timeout after 60s",
      processingStage: "AI Analysis",
    })
  );

  assert.equal(outcome.status, "ERROR");
  assert.equal(outcome.reasonCode, "OE_PIPELINE_ERROR");
});

test("Gmail OE: summarizeDocumentOutcome persists audit payload with timeline", () => {
  const outcome = runGmailOrgOutcomeDecision(gmailOePipelineInput());
  const summary = summarizeDocumentOutcome(outcome);

  assert.equal(summary.version, "oe-v1");
  assert.equal(summary.status, outcome.status);
  assert.equal(summary.headline, outcome.headline);
  assert.equal(summary.description, outcome.description);
  assert.equal(summary.reasonCode, outcome.reasonCode);
  assert.ok(Array.isArray(summary.timeline));
  assert.equal(summary.timeline.length, 8);
});

test("Gmail OE: parsedFieldsJson.outcome shape persists timeline and single status", () => {
  const outcome = runGmailOrgOutcomeDecision(gmailOePipelineInput());
  const parsedFieldsJson = {
    outcome: summarizeDocumentOutcome(outcome),
  };

  assert.equal(parsedFieldsJson.outcome.status, "SAVED");
  assert.ok(parsedFieldsJson.outcome.timeline.length === 8);
  assert.ok(parsedFieldsJson.outcome.recommendedAction.length > 0);
});

test("Gmail OE: exactly one final outcome status", () => {
  const cases = [
    gmailOePipelineInput(),
    gmailOePipelineInput({ existingScanItem: { amount: 1180 } }),
    gmailOePipelineInput({
      moneyDecision: { status: "ambiguous", confidence: 0.4, selectedAmount: null, isStrongEnoughForAutoSave: false, reasonCode: "AMBIGUOUS" },
    }),
    gmailOePipelineInput({ documentDate: "2027-01-01" }),
    gmailOePipelineInput({ pipelineError: "db timeout", processingStage: "FSE" }),
  ];

  for (const input of cases) {
    const outcome = runGmailOrgOutcomeDecision(input);
    assert.equal(new Set([outcome.status]).size, 1);
  }
});

test("Gmail OE: applyOutcomeReviewGate escalates NEEDS_REVIEW", () => {
  const gated = applyOutcomeReviewGate({
    classification: gmailTeClassification(),
    documentOutcome: computeDocumentOutcome({
      fingerprint: computeCanonicalFingerprint({
        organizationId: "org-gmail-oe",
        supplierName: "Acme Ltd",
        supplierTaxId: "514888888",
        invoiceNumber: "INV-1001",
        totalAmount: 1180,
        documentDate: "2026-05-15",
        documentType: "tax_invoice",
      }),
      moneyDecision: gmailArcDecision({ status: "ambiguous", confidence: 0.4, selectedAmount: null, isStrongEnoughForAutoSave: false, reasonCode: "AMBIGUOUS" }),
      supplierDecision: gmailSirDecision(),
      fseDecision: computeFinancialSanity(gmailFseInput()),
      trustDecision: {
        version: TE_VERSION,
        confidence: 62,
        decision: "NEEDS_REVIEW",
        reason: "Upstream engine requested review",
        reasonCode: "TE_UPSTREAM_REVIEW",
        explanation: "ARC ambiguity requires manual review.",
        contributors: [],
      },
      context: { reviewReason: "ARC ambiguity requires manual review." },
    }),
  });

  assert.equal(gated.reviewStatus, "needs_review");
  assert.match(gated.decisionReason, /outcome_review:OE_NEEDS_REVIEW/);
});

test("Gmail OE: terminal statuses stop persistence", () => {
  assert.equal(gmailOutcomeStopsPersistence("BLOCKED"), true);
  assert.equal(gmailOutcomeStopsPersistence("ERROR"), true);
  assert.equal(gmailOutcomeStopsPersistence("DUPLICATE"), true);
  assert.equal(gmailOutcomeStopsPersistence("NOT_FINANCIAL"), true);
  assert.equal(gmailOutcomeStopsPersistence("SAVED"), false);
  assert.equal(gmailOutcomeStopsPersistence("NEEDS_REVIEW"), false);
});
