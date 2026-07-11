import test from "node:test";
import assert from "node:assert/strict";
import {
  completionErrorMessage,
  getInvoiceCompletionAction,
  resolveInvoiceCompletionId,
  resolveInvoiceCompletionSourceType,
} from "./completionActions";

const baseInvoice = {
  id: "document-review:rev-1",
  clientId: "",
  invoiceNumber: null,
  amount: 49.74,
  amountResolved: true,
  currency: "ILS",
  date: "2026-08-28",
  dueDate: null,
  status: "needs_review" as const,
  reviewStatus: "needs_review" as const,
  source: "financial_document_review" as const,
  reviewSourceId: "rev-1",
  description: null,
  driveUrl: null,
  supplierName: "אונדו",
  documentType: "invoice",
  dataComplete: true,
  approvalRequired: true,
  missingDataReasons: [],
  approvalReasons: ["ממתין לאישור"],
};

test("getInvoiceCompletionAction returns approve for complete data awaiting approval", () => {
  const action = getInvoiceCompletionAction(baseInvoice);
  assert.equal(action.kind, "approve_only");
  assert.equal(action.primaryLabel, "אשר");
  assert.equal(action.canApproveWithoutEdit, true);
});

test("getInvoiceCompletionAction returns complete_details when data is missing", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    dataComplete: false,
    approvalRequired: false,
    missingDataReasons: ["חסר סכום", "ספק לא זוהה"],
  });
  assert.equal(action.kind, "complete_details");
  assert.equal(action.primaryLabel, "השלם פרטים");
});

test("getInvoiceCompletionAction returns complete_and_approve when both gaps exist", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    dataComplete: false,
    approvalRequired: true,
    missingDataReasons: ["חסר סכום"],
  });
  assert.equal(action.kind, "complete_and_approve");
  assert.equal(action.primaryLabel, "השלם ואשר");
});

test("resolveInvoiceCompletionSourceType and id strip prefixes", () => {
  assert.equal(resolveInvoiceCompletionSourceType({ ...baseInvoice, id: "gmail-scan:gsi-1", source: "gmail_scan_item" }), "gmail-scan-item");
  assert.equal(resolveInvoiceCompletionId({ ...baseInvoice, id: "supplier-payment:pay-1" }), "pay-1");
});

test("completionErrorMessage surfaces Hebrew backend errors", () => {
  assert.equal(completionErrorMessage("לא ניתן לאשר — חסר סכום"), "לא ניתן לאשר — חסר סכום");
  assert.match(completionErrorMessage("Document review item not found"), /לא נמצא/);
});
