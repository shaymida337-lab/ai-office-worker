import test from "node:test";
import assert from "node:assert/strict";
import { missingInvoicesReportWhere } from "./supplierPaymentsSheet.js";

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
