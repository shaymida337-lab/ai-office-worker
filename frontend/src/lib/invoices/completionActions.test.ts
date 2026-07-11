import test from "node:test";
import assert from "node:assert/strict";
import {
  completionErrorMessage,
  getInvoiceCompletionAction,
  inferInvoiceCompletionFlags,
  resolveInvoiceCompletionId,
  resolveInvoiceCompletionSourceType,
  shouldOpenEditAfterCompletionError,
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

test("getInvoiceCompletionAction returns approve only when backend marks canApproveDirectly", () => {
  const action = getInvoiceCompletionAction({ ...baseInvoice, canApproveDirectly: true });
  assert.equal(action.kind, "approve_only");
  assert.equal(action.primaryLabel, "אשר");
});

test("getInvoiceCompletionAction routes supplier confirmation to edit supplier", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    supplierNeedsConfirmation: true,
    approvalBlockReason: "supplier.needs_confirmation",
  });
  assert.equal(action.kind, "edit_supplier");
  assert.equal(action.primaryLabel, "ערוך ספק");
});

test("getInvoiceCompletionAction shows complete details when approval still blocked", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    canApproveDirectly: false,
    approvalBlockReason: "amount.unresolved",
  });
  assert.equal(action.kind, "complete_details");
  assert.equal(action.primaryLabel, "השלם פרטים");
});

test("inferInvoiceCompletionFlags falls back to completionReasons", () => {
  const flags = inferInvoiceCompletionFlags({
    ...baseInvoice,
    dataComplete: undefined,
    approvalRequired: undefined,
    missingDataReasons: undefined,
    approvalReasons: undefined,
    completionReasons: ["ממתין לאישור"],
  });
  assert.equal(flags.dataComplete, true);
  assert.equal(flags.approvalRequired, true);
});

test("shouldOpenEditAfterCompletionError detects supplier confirmation failures", () => {
  assert.equal(
    shouldOpenEditAfterCompletionError("לא ניתן לאשר מסמך — יש לאשר או לערוך את שם הספק לפני האישור (supplier.needs_confirmation)"),
    true,
  );
});

test("completionErrorMessage preserves Hebrew backend errors", () => {
  assert.equal(completionErrorMessage("לא ניתן לאשר — חסר סכום"), "לא ניתן לאשר — חסר סכום");
});

test("resolveInvoiceCompletionSourceType and id strip prefixes", () => {
  assert.equal(resolveInvoiceCompletionSourceType({ ...baseInvoice, id: "gmail-scan:gsi-1", source: "gmail_scan_item" }), "gmail-scan-item");
  assert.equal(resolveInvoiceCompletionId({ ...baseInvoice, id: "supplier-payment:pay-1" }), "pay-1");
});
