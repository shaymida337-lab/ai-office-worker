import test from "node:test";
import assert from "node:assert/strict";
import type { EmailAnalysis } from "./claude.js";
import {
  ingestWhatsAppInvoiceMedia,
  matchWhatsAppFinancialDocumentCandidate,
  selectWhatsAppInvoiceAmount,
} from "./whatsappInvoiceIngestion.js";

function acceptedInvoiceAnalysis(): EmailAnalysis {
  return {
    supplier: "OpenAI LLC",
    supplierTaxId: "123456789",
    amount: 120,
    amountBeforeVat: 100,
    vatAmount: 20,
    totalAmount: 120,
    currency: "ILS",
    documentType: "invoice",
    paymentRequired: true,
    dueDate: "2026-06-15",
    invoiceDate: "2026-06-01",
    invoiceNumber: "INV-2026-1001",
    tasks: [],
    confidence: 0.85,
  };
}

function createWhatsAppMediaInput() {
  return {
    organizationId: "org-whatsapp-1",
    clientId: null,
    whatsappLogId: "log-whatsapp-1",
    fromNumber: "whatsapp:+972501234567",
    body: "",
    media: [{
      url: "https://api.twilio.com/media/MM123",
      contentType: "image/jpeg",
      filename: null,
    }],
  };
}

test("WhatsApp image with no Gmail connection creates a FinancialDocumentReview with analysis", async () => {
  const recordedReviews: Array<Record<string, unknown>> = [];
  const result = await ingestWhatsAppInvoiceMedia(createWhatsAppMediaInput(), {
    organizationLookup: async () => ({ businessName: "Test Business" }),
    downloadTwilioMediaFn: async () => Buffer.from("fake-jpeg-bytes"),
    analyzeWhatsAppDocumentFn: async () => acceptedInvoiceAnalysis(),
    getGoogleClientsIfAvailable: async () => null,
    recordFinancialDocumentDecisionFn: async (input) => {
      recordedReviews.push({
        source: input.source,
        fileName: input.fileName,
        supplierName: input.supplierName,
        rawAnalysis: input.rawAnalysis,
      });
      return {
        action: "accepted" as const,
        documentFingerprint: "fp-1",
        sourceFingerprint: "sfp-1",
        documentType: "invoice",
      };
    },
    findExistingCrossSourceDuplicateFn: async () => null,
    uploadInvoiceAttachmentToDriveFn: async () => {
      throw new Error("Drive upload should not run without Google");
    },
  });

  assert.equal(recordedReviews.length, 1);
  assert.equal(recordedReviews[0]?.source, "whatsapp");
  assert.equal(recordedReviews[0]?.fileName, "whatsapp_atsapp-1_1.jpg");
  assert.equal(recordedReviews[0]?.supplierName, "OpenAI LLC");
  assert.ok(recordedReviews[0]?.rawAnalysis);
  assert.equal(result.processed.length, 1);
  assert.equal(result.processed[0]?.driveLink, null);
  assert.equal(result.processed[0]?.duplicateReason, "google_not_connected");
});

test("WhatsApp ingestion skips Drive upload gracefully when Google is unavailable", async () => {
  let driveLookupCalled = false;
  let driveUploadCalled = false;

  const result = await ingestWhatsAppInvoiceMedia(createWhatsAppMediaInput(), {
    organizationLookup: async () => ({ businessName: "Test Business" }),
    downloadTwilioMediaFn: async () => Buffer.from("fake-jpeg-bytes"),
    analyzeWhatsAppDocumentFn: async () => acceptedInvoiceAnalysis(),
    getGoogleClientsIfAvailable: async () => null,
    recordFinancialDocumentDecisionFn: async () => ({
      action: "accepted" as const,
      documentFingerprint: "fp-1",
      sourceFingerprint: "sfp-1",
      documentType: "invoice",
    }),
    findExistingCrossSourceDuplicateFn: async () => null,
    findExistingSupplierDriveDocumentFn: async () => {
      driveLookupCalled = true;
      return null;
    },
    uploadInvoiceAttachmentToDriveFn: async () => {
      driveUploadCalled = true;
      return {
        fileId: "drive-file-1",
        webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
        folderId: "folder-1",
        clientFolderId: null,
        supplierFolderId: "supplier-folder-1",
        folderPath: "Invoices/OpenAI",
        folderWebViewLink: null,
        invoiceMonth: 6,
        invoiceYear: 2026,
      };
    },
  });

  assert.equal(driveLookupCalled, false);
  assert.equal(driveUploadCalled, false);
  assert.equal(result.processed[0]?.created, false);
  assert.equal(result.processed[0]?.driveLink, null);
});

test("Gmail-connected organizations continue to upload to Drive", async () => {
  let driveUploadCalled = false;
  const mockDrive = {} as never;

  const result = await ingestWhatsAppInvoiceMedia(createWhatsAppMediaInput(), {
    organizationLookup: async () => ({ businessName: "Test Business" }),
    downloadTwilioMediaFn: async () => Buffer.from("fake-jpeg-bytes"),
    analyzeWhatsAppDocumentFn: async () => acceptedInvoiceAnalysis(),
    ensureWhatsAppDriveContextFn: async () => ({
      drive: mockDrive,
      rootFolderId: "root-folder-1",
    }),
    recordFinancialDocumentDecisionFn: async () => ({
      action: "accepted" as const,
      documentFingerprint: "fp-1",
      sourceFingerprint: "sfp-1",
      documentType: "invoice",
    }),
    findExistingCrossSourceDuplicateFn: async () => null,
    findExistingSupplierDriveDocumentFn: async () => null,
    uploadInvoiceAttachmentToDriveFn: async () => {
      driveUploadCalled = true;
      return {
        fileId: "drive-file-1",
        webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
        folderId: "folder-1",
        clientFolderId: null,
        supplierFolderId: "supplier-folder-1",
        folderPath: "Invoices/OpenAI",
        folderWebViewLink: null,
        invoiceMonth: 6,
        invoiceYear: 2026,
      };
    },
    upsertWhatsAppSupplierPaymentFn: async () => ({ id: null, created: false }),
  });

  assert.equal(driveUploadCalled, true);
  assert.equal(result.processed[0]?.driveLink, "https://drive.google.com/file/d/drive-file-1/view");
  assert.equal(result.processed[0]?.created, false);
});

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
