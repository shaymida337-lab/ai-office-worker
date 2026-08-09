import assert from "node:assert/strict";
import {
  enrichReviewInvoiceCandidateWithCompleteness,
  mergeInvoiceListCandidates,
  summarizeCandidatesByMonth,
} from "../src/routes/api.js";
import {
  filterInvoicesByCompleteness,
  INVOICE_COMPLETION_REASON,
} from "../src/services/amount/invoiceCompleteness.js";

const approvedAt = new Date("2026-07-07T08:00:00.000Z");

const completeApproved = enrichReviewInvoiceCandidateWithCompleteness({
  id: "supplier-payment:complete-1",
  clientId: "",
  invoiceNumber: "INV-1",
  amount: 120,
  amountLabel: "₪120.00",
  amountResolved: true,
  currency: "ILS",
  currencyExplicit: true,
  date: approvedAt,
  documentDateExplicit: true,
  dueDate: null,
  status: "approved",
  reviewStatus: "approved",
  source: "supplier_payment",
  reviewSourceId: "complete-1",
  description: null,
  driveUrl: null,
  driveFileUrl: null,
  client: null,
  supplierName: "ספק תקין",
  fromEmail: null,
  gmailMessageId: null,
  confidenceScore: 0.9,
  decisionReason: null,
  attachmentFilename: null,
  documentType: "tax_invoice",
  parsedFieldsJson: null,
  createdAt: approvedAt,
  updatedAt: approvedAt,
});

const missingAmount = enrichReviewInvoiceCandidateWithCompleteness({
  id: "gmail-scan:missing-amount",
  clientId: "",
  invoiceNumber: null,
  amount: null,
  amountLabel: "סכום חסר",
  amountResolved: false,
  currency: "ILS",
  currencyExplicit: true,
  date: approvedAt,
  documentDateExplicit: true,
  dueDate: null,
  status: "approved",
  reviewStatus: "approved",
  source: "gmail_scan_item",
  reviewSourceId: "missing-amount",
  description: null,
  driveUrl: null,
  driveFileUrl: null,
  client: null,
  supplierName: "ספק תקין",
  fromEmail: null,
  gmailMessageId: "gmail-1",
  confidenceScore: "high",
  decisionReason: null,
  attachmentFilename: null,
  documentType: "invoice",
  parsedFieldsJson: null,
  createdAt: approvedAt,
  updatedAt: approvedAt,
});

const missingSupplier = enrichReviewInvoiceCandidateWithCompleteness({
  id: "gmail-scan:missing-supplier",
  clientId: "",
  invoiceNumber: null,
  amount: 50,
  amountLabel: "₪50.00",
  amountResolved: true,
  currency: "ILS",
  currencyExplicit: true,
  date: approvedAt,
  documentDateExplicit: true,
  dueDate: null,
  status: "approved",
  reviewStatus: "approved",
  source: "gmail_scan_item",
  reviewSourceId: "missing-supplier",
  description: null,
  driveUrl: null,
  driveFileUrl: null,
  client: null,
  supplierName: "unknown",
  fromEmail: null,
  gmailMessageId: "gmail-2",
  confidenceScore: "high",
  decisionReason: null,
  attachmentFilename: null,
  documentType: "invoice",
  parsedFieldsJson: null,
  createdAt: approvedAt,
  updatedAt: approvedAt,
});

const needsApproval = enrichReviewInvoiceCandidateWithCompleteness({
  id: "document-review:needs-approval",
  clientId: "",
  invoiceNumber: "R-9",
  amount: 90,
  amountLabel: "₪90.00",
  amountResolved: true,
  currency: "ILS",
  currencyExplicit: true,
  date: approvedAt,
  documentDateExplicit: true,
  dueDate: null,
  status: "needs_review",
  reviewStatus: "needs_review",
  source: "financial_document_review",
  reviewSourceId: "needs-approval",
  description: null,
  driveUrl: null,
  driveFileUrl: null,
  client: null,
  supplierName: "ספק תקין",
  fromEmail: null,
  gmailMessageId: null,
  confidenceScore: 0.95,
  decisionReason: null,
  attachmentFilename: null,
  documentType: "invoice",
  parsedFieldsJson: null,
  createdAt: approvedAt,
  updatedAt: approvedAt,
});

const all = [completeApproved, missingAmount, missingSupplier, needsApproval];
const completeOnly = filterInvoicesByCompleteness(all, "complete");
const incompleteOnly = filterInvoicesByCompleteness(all, "incomplete");
const union = filterInvoicesByCompleteness(all, "all");

assert.equal(completeOnly.length, 1);
assert.equal(completeOnly[0]?.id, completeApproved.id);
assert.ok(!incompleteOnly.some((row) => row.id === completeApproved.id));

assert.ok(incompleteOnly.some((row) => row.id === missingAmount.id));
assert.ok(!completeOnly.some((row) => row.id === missingAmount.id));
assert.ok(incompleteOnly.find((row) => row.id === missingAmount.id)?.completionReasons.includes(INVOICE_COMPLETION_REASON.MISSING_AMOUNT));

assert.ok(incompleteOnly.some((row) => row.id === missingSupplier.id));
assert.ok(incompleteOnly.find((row) => row.id === missingSupplier.id)?.completionReasons.includes(INVOICE_COMPLETION_REASON.SUPPLIER_UNIDENTIFIED));

const needsApprovalRow = incompleteOnly.find((row) => row.id === needsApproval.id);
assert.ok(needsApprovalRow);
assert.ok(needsApprovalRow?.completionReasons.includes(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED));

const completeIds = new Set(completeOnly.map((row) => row.id));
const incompleteIds = new Set(incompleteOnly.map((row) => row.id));
for (const id of completeIds) assert.ok(!incompleteIds.has(id));
assert.equal(union.length, all.length);
assert.equal(new Set(union.map((row) => row.id)).size, all.length);

const completeMonths = summarizeCandidatesByMonth(
  completeOnly.map((row) => ({ ...row, amount: row.amount ?? 0 })),
  (row) => row.date,
);
const incompleteMonths = summarizeCandidatesByMonth(
  incompleteOnly.map((row) => ({ ...row, amount: row.amount ?? 0 })),
  (row) => row.date,
);
assert.equal(completeMonths.reduce((sum, month) => sum + month.count, 0), completeOnly.length);
assert.equal(incompleteMonths.reduce((sum, month) => sum + month.count, 0), incompleteOnly.length);

const merged = mergeInvoiceListCandidates({
  invoiceRows: [],
  gmailScanItems: [
    {
      id: "scan-iso",
      gmailMessageId: "gmail-iso",
      emailMessageId: "email-iso",
      gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-iso",
      sender: "supplier@example.com",
      senderEmail: "supplier@example.com",
      subject: "Invoice",
      occurredAt: approvedAt,
      amount: 80,
      supplierName: "Supplier Ltd",
      attachmentFilename: "invoice.pdf",
      driveFileLink: null,
      confidenceScore: "high",
      reviewStatus: "approved",
      decisionReason: "manual approval",
      documentType: "invoice",
      rawAnalysis: { analysis: { currency: "ILS", invoiceDate: approvedAt.toISOString() } },
      createdAt: approvedAt,
      updatedAt: approvedAt,
    },
  ],
  documentReviews: [],
});
assert.equal(merged.length, 1);
assert.equal(merged[0]?.isComplete, true);

console.log(JSON.stringify({
  ok: true,
  completeCount: completeOnly.length,
  incompleteCount: incompleteOnly.length,
  unionCount: union.length,
  overlap: 0,
  checks: [
    "complete-only-approved-full",
    "missing-amount-incomplete-only",
    "missing-supplier-incomplete-only",
    "needs-approval-reason",
    "no-overlap",
    "union-equals-all",
    "months-respect-group",
    "merge-approved-complete",
  ],
}, null, 2));
