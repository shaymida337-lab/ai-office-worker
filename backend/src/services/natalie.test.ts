import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import {
  askNatalieBusinessQuestion,
  expandInvoiceSearchTerms,
  extractShowInvoiceSearchTerm,
  extractSupplierSearchTerm,
  isLikelyConversationalQuestion,
  isShowInvoiceRequest,
  mapSupplierPaymentToShowInvoiceItem,
  mergeShowInvoiceItems,
  selectNatalieInvoiceDriveUrl,
} from "./natalie.js";

const ORG = "org-natalie-test";
const OTHER_ORG = "org-other";

test("conversational greeting is detected and answered without Claude", async () => {
  assert.equal(isLikelyConversationalQuestion("שלום נטלי, מה שלומך?"), true);
  assert.equal(isLikelyConversationalQuestion("כמה חשבוניות יש לי?"), false);

  const result = await askNatalieBusinessQuestion({
    organizationId: ORG,
    question: "שלום נטלי, מה שלומך?",
  });
  assert.equal("answer" in result, true);
  if (!("answer" in result)) return;
  assert.match(result.answer, /שלום/);
});

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

test("isShowInvoiceRequest accepts Hebrew plural invoices and masculine verbs", () => {
  assert.equal(isShowInvoiceRequest("מצא חשבוניות מספק וולט"), true);
  assert.equal(isShowInvoiceRequest("תוציא לי חשבוניות של פנגו"), true);
  assert.equal(isShowInvoiceRequest("כמה חשבוניות יש לי"), false);
});

test("extractShowInvoiceSearchTerm parses Hebrew supplier invoice queries", () => {
  assert.equal(extractShowInvoiceSearchTerm("מצא חשבוניות מספק וולט"), "וולט");
  assert.equal(extractShowInvoiceSearchTerm("תוציא לי חשבוניות של פנגו"), "פנגו");
  assert.equal(extractShowInvoiceSearchTerm("תראה לי חשבוניות של וולט"), "וולט");
  assert.equal(extractShowInvoiceSearchTerm("מצא לי חשבוניות של וולט"), "וולט");
  assert.equal(extractShowInvoiceSearchTerm("יש לי חשבוניות מוולט?"), "וולט");
  assert.equal(extractShowInvoiceSearchTerm("תציג את החשבונית האחרונה של וולט"), "וולט");
  assert.equal(extractShowInvoiceSearchTerm("יש לי קבלה מוולט?"), "וולט");
});

test("extractSupplierSearchTerm parses Hebrew preposition variants", () => {
  assert.equal(extractSupplierSearchTerm("כמה חשבוניות יש לי מוולט?"), "וולט");
  assert.equal(extractSupplierSearchTerm("כמה שילמתי לוולט החודש?"), "וולט");
  assert.equal(extractSupplierSearchTerm("כמה שילמתי לפנגו השנה?"), "פנגו");
  assert.equal(extractSupplierSearchTerm("מה החשבונית הכי יקרה של וולט?"), "וולט");
});

test("isShowInvoiceRequest routes natural Hebrew show/list phrasing", () => {
  assert.equal(isShowInvoiceRequest("תראה לי חשבוניות של וולט"), true);
  assert.equal(isShowInvoiceRequest("מצא לי חשבוניות של וולט"), true);
  assert.equal(isShowInvoiceRequest("יש לי חשבוניות מוולט?"), true);
  assert.equal(isShowInvoiceRequest("תציג את החשבונית האחרונה של וולט"), true);
  assert.equal(isShowInvoiceRequest("יש לי קבלה מוולט?"), true);
  assert.equal(isShowInvoiceRequest("כמה חשבוניות יש לי מוולט?"), false);
  assert.equal(isShowInvoiceRequest("מה החשבונית הכי יקרה של וולט?"), false);
  assert.equal(isShowInvoiceRequest("כמה שילמתי לוולט החודש?"), false);
});

test("show_invoice handles Hebrew Wolt supplier query", async () => {
  const restore = installShowInvoicePrismaStub({
    invoices: [approvedWoltInvoice],
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "מצא חשבוניות מספק וולט",
    });

    assert.ok("action" in result && result.action === "show_invoice");
    if (!("action" in result) || result.action !== "show_invoice") return;
    assert.equal(result.invoices[0]?.supplierName, "Wolt");
  } finally {
    restore();
  }
});

test("show_invoice handles Hebrew Pango supplier query", async () => {
  const restore = installShowInvoicePrismaStub({
    supplierPayments: [
      {
        id: "payment-pango-1",
        supplier: "Pango",
        supplierName: null,
        invoiceNumber: "P-100",
        amount: 144,
        currency: "ILS",
        date: new Date("2026-06-01T00:00:00.000Z"),
        dueDate: null,
        paid: false,
        driveFileUrl: null,
        invoiceLink: null,
        documentLink: null,
      },
    ],
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "תוציא לי חשבוניות של פנגו",
    });

    assert.ok("action" in result && result.action === "show_invoice");
    if (!("action" in result) || result.action !== "show_invoice") return;
    assert.equal(result.invoices[0]?.supplierName, "Pango");
  } finally {
    restore();
  }
});

function installBusinessFactsPrismaStub(overrides: {
  supplierPaymentCount?: number;
  invoiceCount?: number;
  supplierInvoiceCount?: number;
  supplierPaymentMatchCount?: number;
  supplierReviewCount?: number;
  paidAmountSum?: number;
  topInvoice?: { supplierName: string | null; amount: number } | null;
  topPayment?: { supplierName: string | null; supplier: string; amount: number } | null;
  needsReviewInvoiceCount?: number;
  needsReviewDocumentCount?: number;
}) {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    supplierPaymentCount: prisma.supplierPayment.count.bind(prisma.supplierPayment),
    supplierPaymentAggregate: prisma.supplierPayment.aggregate.bind(prisma.supplierPayment),
    invoiceCount: prisma.invoice.count.bind(prisma.invoice),
    invoiceFindFirst: prisma.invoice.findFirst.bind(prisma.invoice),
    supplierPaymentFindFirst: prisma.supplierPayment.findFirst.bind(prisma.supplierPayment),
    financialDocumentReviewCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
  };

  prisma.organization.findUnique = (async () => ({ businessProfile: null })) as unknown as typeof prisma.organization.findUnique;
  prisma.supplierPayment.count = (async (args) => {
    if (args?.where && typeof args.where === "object" && "OR" in args.where) {
      return overrides.supplierPaymentMatchCount ?? 0;
    }
    return overrides.supplierPaymentCount ?? 0;
  }) as typeof prisma.supplierPayment.count;
  prisma.supplierPayment.aggregate = (async () => ({
    _sum: { amount: overrides.paidAmountSum ?? 0 },
  })) as unknown as typeof prisma.supplierPayment.aggregate;
  prisma.invoice.count = (async (args) => {
    if (args?.where && typeof args.where === "object" && "status" in args.where) {
      return overrides.needsReviewInvoiceCount ?? 0;
    }
    if (args?.where && typeof args.where === "object" && "OR" in args.where) {
      return overrides.supplierInvoiceCount ?? 0;
    }
    return overrides.invoiceCount ?? 0;
  }) as typeof prisma.invoice.count;
  prisma.invoice.findFirst = (async () => overrides.topInvoice ?? null) as typeof prisma.invoice.findFirst;
  prisma.supplierPayment.findFirst = (async () => overrides.topPayment ?? null) as typeof prisma.supplierPayment.findFirst;
  prisma.financialDocumentReview.count = (async (args) => {
    if (args?.where && typeof args.where === "object" && "OR" in args.where) {
      return overrides.supplierReviewCount ?? 0;
    }
    return overrides.needsReviewDocumentCount ?? 0;
  }) as typeof prisma.financialDocumentReview.count;

  return () => {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.supplierPayment.count = originals.supplierPaymentCount;
    prisma.supplierPayment.aggregate = originals.supplierPaymentAggregate;
    prisma.invoice.count = originals.invoiceCount;
    prisma.invoice.findFirst = originals.invoiceFindFirst;
    prisma.supplierPayment.findFirst = originals.supplierPaymentFindFirst;
    prisma.financialDocumentReview.count = originals.financialDocumentReviewCount;
  };
}

test("business facts: payments this month", async () => {
  const restore = installBusinessFactsPrismaStub({ supplierPaymentCount: 4 });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "כמה תשלומים יש לי החודש",
    });
    assert.match(result.answer, /4/);
    assert.match(result.answer, /תשלומי ספקים החודש/);
  } finally {
    restore();
  }
});

test("business facts: total invoice count", async () => {
  const restore = installBusinessFactsPrismaStub({ invoiceCount: 12 });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "כמה חשבוניות יש לי",
    });
    assert.match(result.answer, /12/);
  } finally {
    restore();
  }
});

test("business facts: highest supplier", async () => {
  const restore = installBusinessFactsPrismaStub({
    topInvoice: { supplierName: "Wolt", amount: 500 },
    topPayment: { supplierName: null, supplier: "Pango", amount: 120 },
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "מי הספק הכי יקר שלי",
    });
    assert.match(result.answer, /Wolt/);
    assert.match(result.answer, /500/);
  } finally {
    restore();
  }
});

test("business facts: unapproved invoices", async () => {
  const restore = installBusinessFactsPrismaStub({
    needsReviewInvoiceCount: 2,
    needsReviewDocumentCount: 1,
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "חשבוניות שלא אושרו",
    });
    assert.match(result.answer, /3/);
    assert.match(result.answer, /ממתינות לאישור/);
  } finally {
    restore();
  }
});

const HEBREW_SHOW_INVOICE_PHRASES = [
  "תראה לי חשבוניות של וולט",
  "מצא לי חשבוניות של וולט",
  "יש לי חשבוניות מוולט?",
  "תציג את החשבונית האחרונה של וולט",
  "יש לי קבלה מוולט?",
] as const;

for (const question of HEBREW_SHOW_INVOICE_PHRASES) {
  test(`Hebrew launch QA show_invoice: ${question}`, async () => {
    const restore = installShowInvoicePrismaStub({
      invoices: [approvedWoltInvoice],
    });
    try {
      const result = await askNatalieBusinessQuestion({
        organizationId: ORG,
        question,
      });
      assert.ok("action" in result && result.action === "show_invoice", `expected show_invoice for: ${question}`);
      if (!("action" in result) || result.action !== "show_invoice") return;
      assert.equal(result.invoices[0]?.supplierName, "Wolt");
      assert.doesNotMatch(result.answer, /לא מצאתי מידע/);
    } finally {
      restore();
    }
  });
}

test("Hebrew launch QA: supplier invoice count", async () => {
  const restore = installBusinessFactsPrismaStub({
    supplierInvoiceCount: 2,
    supplierPaymentMatchCount: 1,
    supplierReviewCount: 0,
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "כמה חשבוניות יש לי מוולט?",
    });
    assert.match(result.answer, /3/);
    assert.match(result.answer, /וולט/);
    assert.doesNotMatch(result.answer, /לא מצאתי מידע/);
  } finally {
    restore();
  }
});

test("Hebrew launch QA: supplier highest invoice", async () => {
  const restore = installBusinessFactsPrismaStub({
    topInvoice: { supplierName: "Wolt", amount: 420 },
    topPayment: { supplierName: null, supplier: "Wolt", amount: 99 },
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "מה החשבונית הכי יקרה של וולט?",
    });
    assert.match(result.answer, /420/);
    assert.match(result.answer, /וולט/);
    assert.doesNotMatch(result.answer, /לא מצאתי מידע/);
  } finally {
    restore();
  }
});

test("Hebrew launch QA: paid amount this month", async () => {
  const restore = installBusinessFactsPrismaStub({ paidAmountSum: 250.5 });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "כמה שילמתי לוולט החודש?",
    });
    assert.match(result.answer, /250/);
    assert.match(result.answer, /וולט/);
    assert.match(result.answer, /החודש/);
    assert.doesNotMatch(result.answer, /לא מצאתי מידע/);
  } finally {
    restore();
  }
});

test("Hebrew launch QA: paid amount this year", async () => {
  const restore = installBusinessFactsPrismaStub({ paidAmountSum: 1800 });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "כמה שילמתי לפנגו השנה?",
    });
    assert.match(result.answer, /1,?800/);
    assert.match(result.answer, /פנגו/);
    assert.match(result.answer, /השנה/);
    assert.doesNotMatch(result.answer, /לא מצאתי מידע/);
  } finally {
    restore();
  }
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
