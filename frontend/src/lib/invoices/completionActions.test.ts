import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  completionErrorMessage,
  getInvoiceCompletionAction,
  getInvoiceStatusChips,
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

test("missing amount only shows הזן סכום", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    dataComplete: false,
    amount: null,
    missingDataReasons: ["חסר סכום"],
  });
  assert.equal(action.primaryLabel, "הזן סכום");
  assert.equal(action.focusField, "amount");
});

test("missing supplier only shows בחר ספק", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    dataComplete: false,
    supplierName: "",
    missingDataReasons: ["ספק לא זוהה"],
  });
  assert.equal(action.primaryLabel, "בחר ספק");
  assert.equal(action.focusField, "supplier");
});

test("supplierNeedsConfirmation shows אשר ספק", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    supplierNeedsConfirmation: true,
    approvalBlockReason: "supplier.needs_confirmation",
  });
  assert.equal(action.kind, "edit_supplier");
  assert.equal(action.primaryLabel, "אשר ספק");
});

test("missing date only shows בחר תאריך", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    dataComplete: false,
    date: "",
    missingDataReasons: ["חסר תאריך"],
  });
  assert.equal(action.primaryLabel, "בחר תאריך");
  assert.equal(action.focusField, "date");
});

test("two missing fields show ערוך פרטים", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    dataComplete: false,
    missingDataReasons: ["ספק לא זוהה", "חסר סכום"],
  });
  assert.equal(action.primaryLabel, "ערוך פרטים");
});

test("complete + canApproveDirectly shows אשר", () => {
  const action = getInvoiceCompletionAction({ ...baseInvoice, canApproveDirectly: true });
  assert.equal(action.kind, "approve_only");
  assert.equal(action.primaryLabel, "אשר");
});

test("blocked_outcome shows בדוק מסמך", () => {
  const action = getInvoiceCompletionAction({
    ...baseInvoice,
    canApproveDirectly: false,
    approvalBlockReason: "blocked_outcome",
  });
  assert.equal(action.kind, "blocked");
  assert.equal(action.primaryLabel, "בדוק מסמך");
});

test("never returns השלם ואשר for representative fixtures", () => {
  const fixtures = [
    { ...baseInvoice, dataComplete: false, missingDataReasons: ["חסר סכום"], approvalRequired: true },
    { ...baseInvoice, dataComplete: false, missingDataReasons: ["ספק לא זוהה", "חסר סכום"], approvalRequired: true },
    { ...baseInvoice, canApproveDirectly: true },
    { ...baseInvoice, supplierNeedsConfirmation: true, approvalBlockReason: "supplier.needs_confirmation" },
    { ...baseInvoice, approvalBlockReason: "blocked_outcome" },
    { ...baseInvoice, documentType: "newsletter", approvalBlockReason: "מסמך לא רלוונטי" },
  ];
  for (const invoice of fixtures) {
    assert.notEqual(getInvoiceCompletionAction(invoice).primaryLabel, "השלם ואשר");
  }
});

test("Reports UI source does not contain השלם ואשר", () => {
  const reportsClient = readFileSync(join(__dirname, "../../app/reports/ReportsClient.tsx"), "utf8");
  assert.equal(reportsClient.includes("השלם ואשר"), false);
});

test("status chips stay short", () => {
  const chips = getInvoiceStatusChips({
    ...baseInvoice,
    dataComplete: false,
    missingDataReasons: ["ספק לא זוהה", "חסר סכום"],
    approvalReasons: ["ממתין לאישור", "רמת ביטחון נמוכה"],
    approvalBlockReason: "blocked_outcome",
  });
  assert.deepEqual(chips, ["חסר ספק", "חסר סכום", "ממתין לאישור", "חסום"]);
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
