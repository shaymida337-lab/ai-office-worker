import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGmailDriveLinkInvoiceEvidence,
  extractGoogleDriveFileLinks,
  shouldRejectPersonalEmailWithoutDocumentEvidence,
} from "./gmailDriveLinkEvidence.js";
import { classifyGmailScanCandidate } from "./gmail-sync.js";
import type { EmailAnalysis } from "./claude.js";

function analysis(overrides: Partial<EmailAnalysis> = {}): EmailAnalysis {
  return {
    supplier: "Unknown",
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

const DRIVE_PDF_BODY = [
  "shaykedma_1693_2026-05-11_1.pdf",
  "<https://drive.google.com/open?id=1hcsz8yw_bA4fYcnPocdKqSljk7UXdU4L>",
  "",
  " shaykedma_1693_2026-05-11_1.pdf",
].join("\r\n");

const DRIVE_IMAGE_BODY = [
  "vendor_40009107_2025-03-05_unknown.jpeg",
  "<https://drive.google.com/open?id=1EPxbuE0hDDwKWlRbVz3snYqVJA-W2N1t>",
].join("\r\n");

test("Drive PDF link with invoice subject yields strict drive invoice evidence", () => {
  const evidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית לימודים",
    bodyText: DRIVE_PDF_BODY,
  });

  assert.equal(evidence.hasStrictDriveInvoiceEvidence, true);
  assert.deepEqual(evidence.virtualAttachmentFilenames, ["shaykedma_1693_2026-05-11_1.pdf"]);
  assert.equal(evidence.links[0]?.documentKind, "pdf");
});

test("Drive image link with invoice subject yields strict drive invoice evidence", () => {
  const evidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית יומן",
    bodyText: DRIVE_IMAGE_BODY,
  });

  assert.equal(evidence.hasStrictDriveInvoiceEvidence, true);
  assert.equal(evidence.links[0]?.documentKind, "image");
  assert.match(evidence.virtualAttachmentFilenames[0] ?? "", /\.jpeg$/i);
});

test("personal email with random Drive link and no invoice evidence is rejected", () => {
  const evidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "photos from the trip",
    bodyText: "check this out\nhttps://drive.google.com/open?id=1hcsz8yw_bA4fYcnPocdKqSljk7UXdU4L",
  });

  assert.equal(evidence.hasStrictDriveInvoiceEvidence, false);
  assert.equal(
    shouldRejectPersonalEmailWithoutDocumentEvidence({
      isPersonalSender: true,
      hasPdfOrImageAttachment: false,
      strictPaymentEvidence: false,
      driveEvidence: evidence,
    }),
    true,
  );
});

test("personal email with invoice subject but Drive link without pdf/image filename is rejected", () => {
  const evidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית",
    bodyText: "see the file here https://drive.google.com/open?id=1hcsz8yw_bA4fYcnPocdKqSljk7UXdU4L",
  });

  assert.equal(evidence.hasStrictDriveInvoiceEvidence, false);
  assert.equal(
    shouldRejectPersonalEmailWithoutDocumentEvidence({
      isPersonalSender: true,
      hasPdfOrImageAttachment: false,
      strictPaymentEvidence: false,
      driveEvidence: evidence,
    }),
    true,
  );
});

test("personal email with no attachment and no Drive link is rejected", () => {
  const evidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית",
    bodyText: "please pay soon",
  });

  assert.equal(
    shouldRejectPersonalEmailWithoutDocumentEvidence({
      isPersonalSender: true,
      hasPdfOrImageAttachment: false,
      strictPaymentEvidence: false,
      driveEvidence: evidence,
    }),
    true,
  );
});

test("classifyGmailScanCandidate treats virtual Drive PDF filename as strict invoice evidence", () => {
  const driveEvidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית לימודים",
    bodyText: DRIVE_PDF_BODY,
  });
  const result = classifyGmailScanCandidate({
    subject: "חשבונית לימודים",
    bodyText: DRIVE_PDF_BODY,
    attachmentFilenames: driveEvidence.virtualAttachmentFilenames,
    analysis: analysis({ documentType: "invoice", confidence: 0.82 }),
    amount: null,
    supplierName: "Kedma",
    senderEmail: "shaymida337@gmail.com",
    senderDomain: "gmail.com",
  });

  assert.equal(result.documentType, "invoice");
  assert.equal(result.audit.strictPaymentEvidence, true);
  assert.equal(result.isRelevant, true);
  assert.equal(
    shouldRejectPersonalEmailWithoutDocumentEvidence({
      isPersonalSender: true,
      hasPdfOrImageAttachment: false,
      strictPaymentEvidence: result.audit.strictPaymentEvidence,
      driveEvidence,
    }),
    false,
  );
});

test("classifyGmailScanCandidate treats virtual Drive image filename as strict invoice evidence", () => {
  const driveEvidence = evaluateGmailDriveLinkInvoiceEvidence({
    subject: "חשבונית יומן",
    bodyText: DRIVE_IMAGE_BODY,
  });
  const result = classifyGmailScanCandidate({
    subject: "חשבונית יומן",
    bodyText: DRIVE_IMAGE_BODY,
    attachmentFilenames: driveEvidence.virtualAttachmentFilenames,
    analysis: analysis({ documentType: "invoice", confidence: 0.8 }),
    amount: null,
    supplierName: "Wolf Dibs",
    senderEmail: "shaymida337@gmail.com",
    senderDomain: "gmail.com",
  });

  assert.equal(result.documentType, "invoice");
  assert.equal(result.audit.strictPaymentEvidence, true);
  assert.equal(result.isRelevant, true);
});

test("extractGoogleDriveFileLinks ignores folder links", () => {
  const links = extractGoogleDriveFileLinks(
    "folder https://drive.google.com/drive/folders/abc123 invoice.pdf https://drive.google.com/file/d/abc1234567890123456789/view",
  );
  assert.equal(links.length, 1);
  assert.equal(links[0]?.fileId, "abc1234567890123456789");
});
