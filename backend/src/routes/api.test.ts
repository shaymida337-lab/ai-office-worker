import test from "node:test";
import assert from "node:assert/strict";
import {
  debugTopPaymentAmountsWhere,
  invoiceReviewStatusFilter,
  mapGmailScanItemToInvoiceCandidate,
} from "./api.js";

test("debug top-amounts excludes needs_review supplier payments", () => {
  const where = debugTopPaymentAmountsWhere("org-1");

  assert.equal(where.approvalStatus, "approved");
});

test("debug top-amounts still includes approved supplier payments", () => {
  assert.deepEqual(debugTopPaymentAmountsWhere("org-1"), {
    organizationId: "org-1",
    approvalStatus: "approved",
    paid: false,
    paymentRequired: true,
    amount: { gte: 0, lte: 1_000_000 },
  });
});

test("invoice review status filter recognizes UI review tabs", () => {
  assert.equal(invoiceReviewStatusFilter("approved"), "approved");
  assert.equal(invoiceReviewStatusFilter("needs_review"), "needs_review");
  assert.equal(invoiceReviewStatusFilter("rejected"), "rejected");
  assert.equal(invoiceReviewStatusFilter("paid"), undefined);
});

test("gmail scan item maps to needs_review invoice candidate", () => {
  const now = new Date("2026-06-09T09:00:00.000Z");
  const candidate = mapGmailScanItemToInvoiceCandidate({
    id: "scan-1",
    gmailMessageId: "gmail-1",
    emailMessageId: "email-1",
    gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-1",
    sender: "supplier@example.com",
    senderEmail: "supplier@example.com",
    subject: "Invoice 123",
    occurredAt: now,
    amount: 120,
    supplierName: "Supplier",
    attachmentFilename: "invoice.pdf",
    driveFileLink: null,
    confidenceScore: "medium",
    reviewStatus: "needs_review",
    decisionReason: "business review required",
    rawAnalysis: { invoiceNumber: "123", invoiceDate: "2026-06-01", analysis: { currency: "ILS" } },
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(candidate.id, "gmail-scan:scan-1");
  assert.equal(candidate.invoiceNumber, "123");
  assert.equal(candidate.status, "needs_review");
  assert.equal(candidate.reviewStatus, "needs_review");
  assert.equal(candidate.source, "gmail_scan_item");
});
