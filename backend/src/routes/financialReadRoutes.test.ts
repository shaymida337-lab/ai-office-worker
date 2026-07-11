import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  buildSupplierPaymentReadIsolationWhere,
  mergePrismaWhere,
} from "../services/p0/financialReadIsolation.js";
import { buildInvoiceListQueryContext, buildInvoiceListWhereInput } from "./api.js";

const ORG_A = "org-a";
const ORG_B = "org-b";
const USER_A = "user-a";
const CONTAMINATED = Array.from({ length: 118 }, (_, index) => `gmail-cross-${index}`);

function paymentRow(id: string, organizationId: string, emailMessageId: string | null) {
  return {
    id,
    organizationId,
    emailMessageId,
    supplier: "Supplier",
    amount: 100,
    currency: "ILS",
    date: new Date("2026-06-01T00:00:00.000Z"),
    paid: false,
    source: "gmail",
    firstSource: "gmail",
    lastSource: "gmail",
    sourceCount: 1,
    duplicateDetected: false,
    paymentRequired: false,
    missingInvoice: false,
    firstSeenAt: new Date("2026-06-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    subject: null,
    duplicateReason: null,
    documentLink: null,
    invoiceLink: null,
    driveFileUrl: null,
  };
}

test("supplier payment findMany query uses emailMessageId with 118 cross-org exclusions", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const original = prisma.supplierPayment.findMany.bind(prisma.supplierPayment);
  prisma.supplierPayment.findMany = (async (args) => {
    captured.push((args?.where ?? {}) as Record<string, unknown>);
    return [];
  }) as typeof prisma.supplierPayment.findMany;

  try {
    const where = mergePrismaWhere(
      { organizationId: ORG_A, approvalStatus: "approved" },
      buildSupplierPaymentReadIsolationWhere(ORG_A, CONTAMINATED),
    );
    await prisma.supplierPayment.findMany({ where, orderBy: { date: "desc" }, take: 100 });
    assert.equal(captured.length, 1);
    assert.equal("gmailMessageId" in captured[0]!, false);
    assert.deepEqual(captured[0]!.emailMessageId, { notIn: CONTAMINATED });
  } finally {
    prisma.supplierPayment.findMany = original;
  }
});

test("invoice list supplier payment where uses emailMessageId isolation", () => {
  const ctx = buildInvoiceListQueryContext({ organizationId: ORG_A });
  const base = buildInvoiceListWhereInput(ctx, undefined);
  const where = mergePrismaWhere(
    base.supplierPaymentWhere,
    buildSupplierPaymentReadIsolationWhere(ORG_A, CONTAMINATED),
  );
  assert.equal("gmailMessageId" in where, false);
  assert.deepEqual(where.emailMessageId, { notIn: CONTAMINATED });
});

test("GET /api/payments returns 200 when cross-org contaminated ids are present", async () => {
  const previous = {
    master: process.env.FINANCIAL_DATA_CONTAINMENT,
    read: process.env.FINANCIAL_READ_CONTAINMENT,
    ingestion: process.env.FINANCIAL_INGESTION_CONTAINMENT,
  };
  process.env.FINANCIAL_DATA_CONTAINMENT = "0";
  process.env.FINANCIAL_READ_CONTAINMENT = "0";
  process.env.FINANCIAL_INGESTION_CONTAINMENT = "1";

  const originalUserFindUnique = prisma.user.findUnique.bind(prisma.user);
  const originalOrgFindUnique = prisma.organization.findUnique.bind(prisma.organization);
  const originalMemberFindUnique = prisma.organizationMember.findUnique.bind(prisma.organizationMember);
  const originalPaymentFindMany = prisma.supplierPayment.findMany.bind(prisma.supplierPayment);
  const originalQueryRaw = prisma.$queryRawUnsafe.bind(prisma);

  prisma.user.findUnique = (async () => ({
    id: USER_A,
    email: "a@example.com",
    organization: { id: ORG_A },
  })) as typeof prisma.user.findUnique;
  prisma.organization.findUnique = (async () => ({ userId: USER_A, timezone: "Asia/Jerusalem" })) as typeof prisma.organization.findUnique;
  prisma.organizationMember.findUnique = (async () => null) as typeof prisma.organizationMember.findUnique;
  prisma.$queryRawUnsafe = (async () =>
    CONTAMINATED.map((gmail_id) => ({ gmail_id }))) as typeof prisma.$queryRawUnsafe;
  prisma.supplierPayment.findMany = (async (args) => {
    assert.equal("gmailMessageId" in ((args?.where ?? {}) as Record<string, unknown>), false);
    return [paymentRow("sp-own", ORG_A, "gmail-own")] as Awaited<ReturnType<typeof prisma.supplierPayment.findMany>>;
  }) as typeof prisma.supplierPayment.findMany;

  const { authMiddleware } = await import("../lib/auth.js");
  const { validateTenantMiddleware, financialDataContainmentMiddleware } = await import("../middleware/tenantIsolation.js");
  const { apiRouter } = await import("./api.js");

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use(validateTenantMiddleware);
  app.use(financialDataContainmentMiddleware);
  app.use("/api", apiRouter);

  const token = jwt.sign({ userId: USER_A, organizationId: ORG_A, email: "a@example.com" }, config.jwtSecret, {
    expiresIn: "1h",
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/payments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as unknown[];
    assert.equal(Array.isArray(body), true);
    assert.equal(body.length, 1);
  } finally {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.organization.findUnique = originalOrgFindUnique;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
    prisma.supplierPayment.findMany = originalPaymentFindMany;
    prisma.$queryRawUnsafe = originalQueryRaw;
    if (previous.master === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
    else process.env.FINANCIAL_DATA_CONTAINMENT = previous.master;
    if (previous.read === undefined) delete process.env.FINANCIAL_READ_CONTAINMENT;
    else process.env.FINANCIAL_READ_CONTAINMENT = previous.read;
    if (previous.ingestion === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
    else process.env.FINANCIAL_INGESTION_CONTAINMENT = previous.ingestion;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /api/invoices returns 200 when supplier payment isolation uses emailMessageId", async () => {
  const previous = {
    master: process.env.FINANCIAL_DATA_CONTAINMENT,
    read: process.env.FINANCIAL_READ_CONTAINMENT,
    ingestion: process.env.FINANCIAL_INGESTION_CONTAINMENT,
  };
  process.env.FINANCIAL_DATA_CONTAINMENT = "0";
  process.env.FINANCIAL_READ_CONTAINMENT = "0";
  process.env.FINANCIAL_INGESTION_CONTAINMENT = "1";

  const originals = {
    userFindUnique: prisma.user.findUnique.bind(prisma.user),
    orgFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    memberFindUnique: prisma.organizationMember.findUnique.bind(prisma.organizationMember),
    invoiceFindMany: prisma.invoice.findMany.bind(prisma.invoice),
    gsiFindMany: prisma.gmailScanItem.findMany.bind(prisma.gmailScanItem),
    fdrFindMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
    spFindMany: prisma.supplierPayment.findMany.bind(prisma.supplierPayment),
    emailFindMany: prisma.emailMessage.findMany.bind(prisma.emailMessage),
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
  };

  prisma.user.findUnique = (async () => ({
    id: USER_A,
    email: "a@example.com",
    organization: { id: ORG_A },
  })) as typeof prisma.user.findUnique;
  prisma.organization.findUnique = (async () => ({ userId: USER_A, timezone: "Asia/Jerusalem" })) as typeof prisma.organization.findUnique;
  prisma.organizationMember.findUnique = (async () => null) as typeof prisma.organizationMember.findUnique;
  prisma.$queryRawUnsafe = (async () =>
    CONTAMINATED.map((gmail_id) => ({ gmail_id }))) as typeof prisma.$queryRawUnsafe;
  prisma.invoice.findMany = (async () => []) as typeof prisma.invoice.findMany;
  prisma.gmailScanItem.findMany = (async () => []) as typeof prisma.gmailScanItem.findMany;
  prisma.financialDocumentReview.findMany = (async () => []) as typeof prisma.financialDocumentReview.findMany;
  prisma.emailMessage.findMany = (async () => []) as typeof prisma.emailMessage.findMany;
  prisma.supplierPayment.findMany = (async (args) => {
    assert.equal("gmailMessageId" in ((args?.where ?? {}) as Record<string, unknown>), false);
    return [] as Awaited<ReturnType<typeof prisma.supplierPayment.findMany>>;
  }) as typeof prisma.supplierPayment.findMany;

  const { authMiddleware } = await import("../lib/auth.js");
  const { validateTenantMiddleware, financialDataContainmentMiddleware } = await import("../middleware/tenantIsolation.js");
  const { apiRouter } = await import("./api.js");

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use(validateTenantMiddleware);
  app.use(financialDataContainmentMiddleware);
  app.use("/api", apiRouter);

  const token = jwt.sign({ userId: USER_A, organizationId: ORG_A, email: "a@example.com" }, config.jwtSecret, {
    expiresIn: "1h",
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/invoices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { invoices?: unknown[] };
    assert.ok(Array.isArray(body.invoices));
  } finally {
    prisma.user.findUnique = originals.userFindUnique;
    prisma.organization.findUnique = originals.orgFindUnique;
    prisma.organizationMember.findUnique = originals.memberFindUnique;
    prisma.invoice.findMany = originals.invoiceFindMany;
    prisma.gmailScanItem.findMany = originals.gsiFindMany;
    prisma.financialDocumentReview.findMany = originals.fdrFindMany;
    prisma.supplierPayment.findMany = originals.spFindMany;
    prisma.emailMessage.findMany = originals.emailFindMany;
    prisma.$queryRawUnsafe = originals.queryRaw;
    if (previous.master === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
    else process.env.FINANCIAL_DATA_CONTAINMENT = previous.master;
    if (previous.read === undefined) delete process.env.FINANCIAL_READ_CONTAINMENT;
    else process.env.FINANCIAL_READ_CONTAINMENT = previous.read;
    if (previous.ingestion === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
    else process.env.FINANCIAL_INGESTION_CONTAINMENT = previous.ingestion;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("sharon supplier payment isolation does not include shay-only contaminated allowlist ids", () => {
  const shayOnly = "gmail-cross-1";
  const where = mergePrismaWhere(
    { organizationId: ORG_B, approvalStatus: "approved" },
    buildSupplierPaymentReadIsolationWhere(ORG_B, [shayOnly]),
  );
  assert.deepEqual(where.emailMessageId, { notIn: [shayOnly] });
  const fdrWhere = buildFinancialDocumentReviewReadIsolationWhere(ORG_B, [shayOnly]);
  assert.deepEqual(fdrWhere.gmailMessageId, { notIn: [shayOnly] });
});
