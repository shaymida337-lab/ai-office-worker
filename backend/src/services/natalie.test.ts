import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import {
  askNatalieBusinessQuestion,
  expandInvoiceSearchTerms,
  mapSupplierPaymentToShowInvoiceItem,
  mergeShowInvoiceItems,
  selectNatalieInvoiceDriveUrl,
} from "./natalie.js";

const ORG = "org-natalie-test";
const OTHER_ORG = "org-other";

const woltReviewRow = {
  id: "fdr-wolt-1",
  organizationId: ORG,
  supplierName: "Wolt",
  invoiceNumber: "W-100",
  totalAmount: 163.28,
  currency: "ILS",
  documentDate: new Date("2026-06-10T00:00:00.000Z"),
  dueDate: null,
  reviewStatus: "needs_review",
  documentType: "tax_invoice",
  driveFileUrl: "https://drive.google.com/file/d/wolt-review/view",
  createdAt: new Date("2026-06-10T12:00:00.000Z"),
};

const woltReviewOtherOrgRow = {
  ...woltReviewRow,
  id: "fdr-wolt-other",
  organizationId: OTHER_ORG,
};

const approvedWoltInvoice = {
  id: "invoice-wolt-1",
  supplierName: "Wolt",
  invoiceNumber: "W-200",
  amount: 99,
  currency: "ILS",
  date: new Date("2026-06-11T00:00:00.000Z"),
  dueDate: null,
  status: "pending",
  driveUrl: null,
  driveFileUrl: "https://drive.google.com/file/d/wolt-approved/view",
  gmailMessageId: null,
  createdAt: new Date("2026-06-11T12:00:00.000Z"),
};

type PrismaStub = {
  organizationFindUnique: typeof prisma.organization.findUnique;
  invoiceFindMany: typeof prisma.invoice.findMany;
  supplierPaymentFindMany: typeof prisma.supplierPayment.findMany;
  financialDocumentReviewFindMany: typeof prisma.financialDocumentReview.findMany;
  emailMessageFindMany: typeof prisma.emailMessage.findMany;
};

function installShowInvoicePrismaStub(overrides: {
  invoices?: unknown[];
  supplierPayments?: unknown[];
  financialDocumentReviews?: unknown[];
}) {
  const originals: PrismaStub = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    invoiceFindMany: prisma.invoice.findMany.bind(prisma.invoice),
    supplierPaymentFindMany: prisma.supplierPayment.findMany.bind(prisma.supplierPayment),
    financialDocumentReviewFindMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
    emailMessageFindMany: prisma.emailMessage.findMany.bind(prisma.emailMessage),
  };

  prisma.organization.findUnique = (async () => ({ businessProfile: null })) as unknown as typeof prisma.organization.findUnique;
  prisma.invoice.findMany = (async () => overrides.invoices ?? []) as typeof prisma.invoice.findMany;
  prisma.supplierPayment.findMany = (async () => overrides.supplierPayments ?? []) as typeof prisma.supplierPayment.findMany;
  prisma.financialDocumentReview.findMany = (async (args) => {
    const where = args?.where as {
      organizationId?: string;
      reviewStatus?: string;
      documentType?: { in?: string[] };
      OR?: Array<Record<string, unknown>>;
    };
    const rows = overrides.financialDocumentReviews ?? [];
    const filtered = rows.filter((row) => {
      const review = row as typeof woltReviewRow;
      if (where.organizationId && review.organizationId !== where.organizationId) return false;
      if (where.reviewStatus && review.reviewStatus !== where.reviewStatus) return false;
      if (where.documentType?.in && !where.documentType.in.includes(review.documentType)) return false;
      if (where.OR?.length) {
        const terms = where.OR.flatMap((clause) => {
          const supplier = clause.supplierName as { contains?: string } | undefined;
          const invoiceNumber = clause.invoiceNumber as { contains?: string } | undefined;
          return [supplier?.contains, invoiceNumber?.contains].filter(Boolean) as string[];
        });
        const haystack = `${review.supplierName ?? ""} ${review.invoiceNumber ?? ""}`.toLowerCase();
        if (!terms.some((term) => haystack.includes(term.toLowerCase()))) return false;
      }
      return true;
    });
    return filtered.slice(0, args?.take ?? filtered.length) as Awaited<ReturnType<typeof prisma.financialDocumentReview.findMany>>;
  }) as typeof prisma.financialDocumentReview.findMany;
  prisma.emailMessage.findMany = (async () => []) as typeof prisma.emailMessage.findMany;

  return () => {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.invoice.findMany = originals.invoiceFindMany;
    prisma.supplierPayment.findMany = originals.supplierPaymentFindMany;
    prisma.financialDocumentReview.findMany = originals.financialDocumentReviewFindMany;
    prisma.emailMessage.findMany = originals.emailMessageFindMany;
  };
}

test("show_invoice uses driveFileUrl when driveUrl is missing", () => {
  const driveUrl = selectNatalieInvoiceDriveUrl({
    driveFileUrl: "https://drive.google.com/file/d/drive-file-id/view",
    driveUrl: null,
  });

  assert.equal(driveUrl, "https://drive.google.com/file/d/drive-file-id/view");
});

test("expands Pango supplier aliases bidirectionally", () => {
  assert.ok(expandInvoiceSearchTerms("פנגו").includes("Pango"));
  assert.ok(expandInvoiceSearchTerms("Pango").includes("פנגו"));
});

test("maps SupplierPayment to show_invoice item shape", () => {
  const date = new Date("2026-06-01T00:00:00.000Z");
  const item = mapSupplierPaymentToShowInvoiceItem({
    id: "payment-1",
    supplier: "Pango",
    supplierName: null,
    invoiceNumber: "P-100",
    amount: 144,
    currency: "ILS",
    date,
    dueDate: null,
    paid: false,
    driveFileUrl: null,
    invoiceLink: "https://drive.google.com/pango",
    documentLink: null,
  });

  assert.equal(item.id, "supplier-payment:payment-1");
  assert.equal(item.supplierName, "Pango");
  assert.equal(item.amount, 144);
  assert.equal(item.driveUrl, "https://drive.google.com/pango");
});

test("dedupes SupplierPayment duplicate of existing Invoice show_invoice item", () => {
  const date = new Date("2026-06-01T00:00:00.000Z");
  const invoice = {
    id: "invoice-1",
    supplierName: "Pango",
    invoiceNumber: "P-100",
    amount: 144,
    currency: "ILS",
    issueDate: date,
    dueDate: null,
    status: "pending",
    driveUrl: "https://drive.google.com/invoice",
  };
  const payment = {
    ...invoice,
    id: "supplier-payment:payment-1",
    driveUrl: "https://drive.google.com/payment",
  };

  assert.deepEqual(mergeShowInvoiceItems([invoice], [payment], 5), [invoice]);
});

test("caps merged show_invoice items at the requested limit", () => {
  const date = new Date("2026-06-01T00:00:00.000Z");
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `supplier-payment:${index}`,
    supplierName: `Supplier ${index}`,
    invoiceNumber: `INV-${index}`,
    amount: index + 1,
    currency: "ILS",
    issueDate: date,
    dueDate: null,
    status: "pending",
    driveUrl: null,
  }));

  assert.equal(mergeShowInvoiceItems([], items, 5).length, 5);
});

test("show_invoice includes needs_review FinancialDocumentReview row for Wolt search", async () => {
  const restore = installShowInvoicePrismaStub({
    financialDocumentReviews: [woltReviewRow],
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "find the latest Wolt invoice",
    });

    assert.equal("action" in result && result.action, "show_invoice");
    if (!("action" in result) || result.action !== "show_invoice") return;
    assert.equal(result.invoices.length, 1);
    assert.equal(result.invoices[0]?.supplierName, "Wolt");
    assert.equal(result.invoices[0]?.amount, 163.28);
    assert.equal(result.invoices[0]?.id, "financial-document-review:fdr-wolt-1");
  } finally {
    restore();
  }
});

test("show_invoice marks FinancialDocumentReview matches as pending review", async () => {
  const restore = installShowInvoicePrismaStub({
    financialDocumentReviews: [woltReviewRow],
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "find the latest Wolt invoice",
    });

    assert.ok("action" in result && result.action === "show_invoice");
    if (!("action" in result) || result.action !== "show_invoice") return;
    const item = result.invoices[0] as { pendingReview?: boolean; status?: string };
    assert.equal(item.status, "needs_review");
    assert.equal(item.pendingReview, true);
    assert.match(result.answer, /ממתינה לאישור/);
  } finally {
    restore();
  }
});

test("show_invoice returns approved Invoice normally without pending review marker", async () => {
  const restore = installShowInvoicePrismaStub({
    invoices: [approvedWoltInvoice],
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "find the latest Wolt invoice",
    });

    assert.ok("action" in result && result.action === "show_invoice");
    if (!("action" in result) || result.action !== "show_invoice") return;
    const item = result.invoices[0] as { id?: string; pendingReview?: boolean; status?: string };
    assert.equal(item.id, "invoice-wolt-1");
    assert.equal(item.status, "pending");
    assert.notEqual(item.pendingReview, true);
    assert.doesNotMatch(result.answer, /ממתינה לאישור/);
    assert.match(result.answer, /מצאתי חשבונית/);
  } finally {
    restore();
  }
});

test("show_invoice does not return FinancialDocumentReview rows from another organization", async () => {
  const restore = installShowInvoicePrismaStub({
    financialDocumentReviews: [woltReviewOtherOrgRow],
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "find the latest Wolt invoice",
    });

    assert.equal("answer" in result && !("action" in result), true);
    assert.match(result.answer, /לא מצאתי חשבונית קיימת/);
  } finally {
    restore();
  }
});
