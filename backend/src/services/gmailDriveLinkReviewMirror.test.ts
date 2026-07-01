import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDriveLinkBlockedScanItemDecisionReason,
  evaluateGmailDriveLinkInvoiceEvidence,
  primaryStrictDriveLinkUrl,
  shouldMirrorDriveLinkBlockedScanItem,
  shouldRejectPersonalEmailWithoutDocumentEvidence,
} from "./gmailDriveLinkEvidence.js";
import { upsertDriveLinkBlockedScanItemMirror } from "./gmailDriveLinkReviewMirror.js";
import { buildGmailScanDuplicateKey, classifyGmailScanCandidate } from "./gmail-sync.js";
import type { EmailAnalysis } from "./claude.js";

const DRIVE_PDF_BODY = [
  "shaykedma_1693_2026-05-11_1.pdf",
  "<https://drive.google.com/open?id=1hcsz8yw_bA4fYcnPocdKqSljk7UXdU4L>",
].join("\r\n");

const DRIVE_IMAGE_BODY = [
  "vendor_40009107_2025-03-05_unknown.jpeg",
  "<https://drive.google.com/open?id=1EPxbuE0hDDwKWlRbVz3snYqVJA-W2N1t>",
].join("\r\n");

function analysis(overrides: Partial<EmailAnalysis> = {}): EmailAnalysis {
  return {
    supplier: "Acme Ltd",
    amount: null,
    currency: "ILS",
    documentType: "invoice",
    paymentRequired: false,
    dueDate: null,
    invoiceDate: null,
    invoiceNumber: null,
    tasks: [],
    confidence: 0.5,
    ...overrides,
  };
}

test("strict Drive PDF + terminal blocked outcome mirrors review-only GSI", async () => {
  const driveEvidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית לימודים",
    bodyText: DRIVE_PDF_BODY,
  });
  assert.equal(shouldMirrorDriveLinkBlockedScanItem(driveEvidence, true), true);

  const upsertArgs: unknown[] = [];
  const db = {
    gmailScanItem: {
      upsert: async (args: unknown) => {
        upsertArgs.push(args);
        return { id: "gsi-drive-pdf" };
      },
    },
  };

  const result = await upsertDriveLinkBlockedScanItemMirror(db, {
    organizationId: "org-1",
    duplicateKey: "dup-key",
    email: {
      gmailId: "gmail-1",
      emailRecordId: "em-1",
      from: "sender <shaymida337@gmail.com>",
      senderEmail: "shaymida337@gmail.com",
      subject: "חשבונית לימודים",
      receivedAt: new Date("2026-07-01T12:11:24.000Z"),
    },
    driveLinkEvidence: driveEvidence,
    outcomeStopsPersistence: true,
    outcomeUncertaintyReason: "outcome_BLOCKED:OE_TRUST_BLOCKED:Blocked by FSE critical failure",
    documentType: "invoice",
    confidenceScore: "high",
    classificationDecisionReason: "Held for review: confidence is high",
    attachmentFilename: "shaykedma_1693_2026-05-11_1.pdf",
    supplierName: "Kedma",
    amount: null,
    parsedFieldsJson: { outcome: { status: "BLOCKED" } },
    rawAnalysis: { gmailMessageId: "gmail-1" },
  });

  assert.equal(result?.id, "gsi-drive-pdf");
  const upsert = upsertArgs[0] as {
    create: {
      reviewStatus: string;
      driveFileLink: string;
      driveUploadStatus: string;
      decisionReason: string;
    };
  };
  assert.equal(upsert.create.reviewStatus, "needs_review");
  assert.equal(
    upsert.create.driveFileLink,
    "https://drive.google.com/open?id=1hcsz8yw_bA4fYcnPocdKqSljk7UXdU4L",
  );
  assert.equal(upsert.create.driveUploadStatus, "not_required");
  assert.match(upsert.create.decisionReason, /Blocked for review: outcome_BLOCKED:OE_TRUST_BLOCKED/);
});

test("strict Drive image + terminal blocked outcome mirrors review-only GSI", async () => {
  const driveEvidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית יומן",
    bodyText: DRIVE_IMAGE_BODY,
  });
  const upsertArgs: unknown[] = [];
  const db = {
    gmailScanItem: {
      upsert: async (args: unknown) => {
        upsertArgs.push(args);
        return { id: "gsi-drive-image" };
      },
    },
  };

  const result = await upsertDriveLinkBlockedScanItemMirror(db, {
    organizationId: "org-1",
    duplicateKey: "dup-key-image",
    email: {
      gmailId: "gmail-2",
      emailRecordId: "em-2",
      from: "sender <shaymida337@gmail.com>",
      senderEmail: "shaymida337@gmail.com",
      subject: "חשבונית יומן",
      receivedAt: new Date("2026-07-01T12:13:23.000Z"),
    },
    driveLinkEvidence: driveEvidence,
    outcomeStopsPersistence: true,
    outcomeUncertaintyReason: "outcome_BLOCKED:OE_TRUST_BLOCKED:Blocked by FSE critical failure",
    documentType: "invoice",
    confidenceScore: "high",
    classificationDecisionReason: "Held for review",
    attachmentFilename: "vendor_40009107_2025-03-05_unknown.jpeg",
    supplierName: "Vendor",
    amount: null,
    parsedFieldsJson: {},
    rawAnalysis: {},
  });

  assert.equal(result?.id, "gsi-drive-image");
  const upsert = upsertArgs[0] as { create: { driveFileLink: string; reviewStatus: string } };
  assert.equal(upsert.create.reviewStatus, "needs_review");
  assert.match(upsert.create.driveFileLink, /drive\.google\.com/);
});

test("random Drive link without invoice evidence does not mirror GSI", async () => {
  const driveEvidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "photos from the trip",
    bodyText: "check this https://drive.google.com/open?id=1hcsz8yw_bA4fYcnPocdKqSljk7UXdU4L",
  });
  assert.equal(shouldMirrorDriveLinkBlockedScanItem(driveEvidence, true), false);
  assert.equal(
    shouldRejectPersonalEmailWithoutDocumentEvidence({
      isPersonalSender: true,
      hasPdfOrImageAttachment: false,
      strictPaymentEvidence: false,
      driveEvidence,
    }),
    true,
  );

  const result = await upsertDriveLinkBlockedScanItemMirror(
    { gmailScanItem: { upsert: async () => ({ id: "should-not-run" }) } },
    {
      organizationId: "org-1",
      duplicateKey: "dup",
      email: {
        gmailId: "gmail-3",
        emailRecordId: "em-3",
        from: "sender <shaymida337@gmail.com>",
        senderEmail: "shaymida337@gmail.com",
        subject: "photos",
        receivedAt: new Date(),
      },
      driveLinkEvidence: driveEvidence,
      outcomeStopsPersistence: true,
      outcomeUncertaintyReason: "outcome_BLOCKED:OE_TRUST_BLOCKED",
      documentType: "invoice",
      confidenceScore: "low",
      attachmentFilename: null,
      supplierName: "Unknown",
      amount: null,
      parsedFieldsJson: {},
      rawAnalysis: {},
    },
  );
  assert.equal(result, null);
});

test("normal Gmail PDF attachment path remains unchanged without drive mirror", () => {
  const result = classifyGmailScanCandidate({
    subject: "Invoice INV-1001",
    bodyText: "Please find attached invoice",
    attachmentFilenames: ["invoice-1001.pdf"],
    analysis: analysis({ documentType: "invoice", amount: 1250, confidence: 0.9 }),
    amount: 1250,
    supplierName: "Acme Ltd",
  });

  assert.equal(result.documentType, "invoice");
  assert.equal(result.reviewStatus, "auto_saved");
  assert.equal(result.audit.strictPaymentEvidence, true);

  const driveEvidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "Invoice INV-1001",
    bodyText: "Please find attached invoice",
  });
  assert.equal(shouldMirrorDriveLinkBlockedScanItem(driveEvidence, true), false);
  assert.equal(primaryStrictDriveLinkUrl(driveEvidence), null);
});

test("terminal drive URL uses first strict document link", () => {
  const evidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית",
    bodyText: DRIVE_PDF_BODY,
  });
  assert.equal(
    primaryStrictDriveLinkUrl(evidence),
    "https://drive.google.com/open?id=1hcsz8yw_bA4fYcnPocdKqSljk7UXdU4L",
  );
  assert.match(
    buildDriveLinkBlockedScanItemDecisionReason("outcome_BLOCKED:OE_TRUST_BLOCKED", "Held for review"),
    /Blocked for review: outcome_BLOCKED:OE_TRUST_BLOCKED/,
  );
});

test("blocked mirror duplicate key stays stable for drive-link invoice", () => {
  const key = buildGmailScanDuplicateKey({
    gmailMessageId: "gmail-1",
    attachmentFilename: "shaykedma_1693_2026-05-11_1.pdf",
    supplierName: "Kedma",
    amount: null,
    subject: "חשבונית לימודים",
    occurredAt: new Date("2026-07-01T12:11:24.000Z"),
  });
  assert.match(key, /^[a-f0-9]{40}$/);
});
