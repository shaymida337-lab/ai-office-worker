import test from "node:test";
import assert from "node:assert/strict";
import { hasSupplierPaymentSheetRowData, missingInvoicesReportWhere } from "./supplierPaymentsSheet.js";

function matchesMissingInvoicesReportWhere(
  payment: {
    organizationId: string;
    approvalStatus: string;
    missingInvoice: boolean;
    paid: boolean;
    duplicateDetected: boolean;
  },
  where: ReturnType<typeof missingInvoicesReportWhere>
) {
  return (
    payment.organizationId === where.organizationId &&
    payment.approvalStatus === where.approvalStatus &&
    payment.missingInvoice === where.missingInvoice &&
    payment.paid === where.paid &&
    payment.duplicateDetected === where.duplicateDetected
  );
}

test("missing-invoice list excludes needs_review supplier payments", () => {
  const where = missingInvoicesReportWhere("org-1");

  assert.equal(
    matchesMissingInvoicesReportWhere(
      {
        organizationId: "org-1",
        approvalStatus: "needs_review",
        missingInvoice: true,
        paid: false,
        duplicateDetected: false,
      },
      where
    ),
    false
  );
});

test("missing-invoice list includes approved supplier payments missing an invoice", () => {
  const where = missingInvoicesReportWhere("org-1");

  assert.equal(
    matchesMissingInvoicesReportWhere(
      {
        organizationId: "org-1",
        approvalStatus: "approved",
        missingInvoice: true,
        paid: false,
        duplicateDetected: false,
      },
      where
    ),
    true
  );
});

test("supplier payment sheet rows require identifying data", () => {
  assert.equal(hasSupplierPaymentSheetRowData({ supplier: "", amount: 0 }), false);
  assert.equal(hasSupplierPaymentSheetRowData({ supplier: "", amount: 0, invoiceLink: "https://drive.google.com/file/d/1" }), true);
  assert.equal(hasSupplierPaymentSheetRowData({ supplier: "לא זוהה", amount: 0 }), true);
  assert.equal(hasSupplierPaymentSheetRowData({ supplier: "", amount: 42 }), true);
  assert.equal(hasSupplierPaymentSheetRowData({ supplier: "", amount: 0, invoiceNumber: "INV-1" }), true);
});
