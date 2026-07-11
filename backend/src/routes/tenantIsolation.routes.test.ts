import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";

import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/auth.js";

const ORG_A = "org-tenant-a";
const ORG_B = "org-tenant-b";
const USER_A = "user-tenant-a";
const USER_B = "user-tenant-b";
const INVOICE_A = "invoice-a-1";

type InvoiceRow = {
  id: string;
  organizationId: string;
  invoiceNumber: string;
  amount: number;
  status: string;
  gmailMessageId: string | null;
  createdAt: Date;
};

function seedInvoiceStore() {
  const invoices: InvoiceRow[] = [
    {
      id: INVOICE_A,
      organizationId: ORG_A,
      invoiceNumber: "INV-A-001",
      amount: 500,
      status: "pending",
      gmailMessageId: "gmail-a-1",
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
    },
  ];
  return invoices;
}

async function withTenantIsolationHarness(run: (ctx: { baseUrl: string; tokenForOrgB: string }) => Promise<void>) {
  const previousContainment = process.env.FINANCIAL_DATA_CONTAINMENT;
  const previousReadContainment = process.env.FINANCIAL_READ_CONTAINMENT;
  const previousIngestionContainment = process.env.FINANCIAL_INGESTION_CONTAINMENT;
  process.env.FINANCIAL_DATA_CONTAINMENT = "0";
  process.env.FINANCIAL_READ_CONTAINMENT = "0";
  process.env.FINANCIAL_INGESTION_CONTAINMENT = "0";

  const invoices = seedInvoiceStore();
  const originalUserFindUnique = prisma.user.findUnique.bind(prisma.user);
  const originalOrgFindUnique = prisma.organization.findUnique.bind(prisma.organization);
  const originalMemberFindUnique = prisma.organizationMember.findUnique.bind(prisma.organizationMember);
  const originalInvoiceFindFirst = prisma.invoice.findFirst.bind(prisma.invoice);
  const originalInvoiceFindMany = prisma.invoice.findMany.bind(prisma.invoice);
  const originalGsiFindMany = prisma.gmailScanItem.findMany.bind(prisma.gmailScanItem);
  const originalFdrFindMany = prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview);
  const originalPaymentFindMany = prisma.supplierPayment.findMany.bind(prisma.supplierPayment);
  const originalQueryRaw = prisma.$queryRawUnsafe.bind(prisma);

  prisma.user.findUnique = (async (args: { where: { id: string } }) => {
    if (args.where.id === USER_A) {
      return { id: USER_A, email: "owner-a@example.com", organization: { id: ORG_A, name: "Org A" } };
    }
    if (args.where.id === USER_B) {
      return { id: USER_B, email: "owner-b@example.com", organization: { id: ORG_B, name: "Org B" } };
    }
    return null;
  }) as typeof prisma.user.findUnique;

  prisma.organization.findUnique = (async (args: { where: { id: string } }) => {
    if (args.where.id === ORG_A) return { userId: USER_A, timezone: "Asia/Jerusalem" };
    if (args.where.id === ORG_B) return { userId: USER_B, timezone: "Asia/Jerusalem" };
    return null;
  }) as typeof prisma.organization.findUnique;

  prisma.organizationMember.findUnique = (async () => null) as typeof prisma.organizationMember.findUnique;

  prisma.invoice.findFirst = (async (args) => {
    const orgId = args?.where?.organizationId as string | undefined;
    const id = args?.where?.id as string | undefined;
    return invoices.find((row) => row.id === id && row.organizationId === orgId) ?? null;
  }) as typeof prisma.invoice.findFirst;

  prisma.invoice.findMany = (async (args) => {
    const orgId = args?.where?.organizationId as string | undefined;
    return invoices.filter((row) => row.organizationId === orgId);
  }) as typeof prisma.invoice.findMany;

  prisma.gmailScanItem.findMany = (async () => []) as typeof prisma.gmailScanItem.findMany;
  prisma.financialDocumentReview.findMany = (async () => []) as typeof prisma.financialDocumentReview.findMany;
  prisma.supplierPayment.findMany = (async () => []) as typeof prisma.supplierPayment.findMany;
  prisma.$queryRawUnsafe = (async () => []) as typeof prisma.$queryRawUnsafe;

  const { authMiddleware } = await import("../lib/auth.js");
  const { validateTenantMiddleware, financialDataContainmentMiddleware } = await import("../middleware/tenantIsolation.js");

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use(validateTenantMiddleware);
  app.use(financialDataContainmentMiddleware);
  app.get("/invoices", async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const rows = await prisma.invoice.findMany({ where: { organizationId } });
    res.json({ invoices: rows });
  });
  app.put("/invoices/:id/status", async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const invoice = await prisma.invoice.findFirst({
      where: { id: String(req.params.id), organizationId },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    res.json({ invoice });
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const tokenForOrgB = signToken({ userId: USER_B, organizationId: ORG_B, email: "owner-b@example.com" });
  const staleTokenOrgAForUserB = signToken({ userId: USER_B, organizationId: ORG_A, email: "owner-b@example.com" });

  try {
    await run({ baseUrl, tokenForOrgB: tokenForOrgB });

    const staleResponse = await fetch(`${baseUrl}/invoices`, {
      headers: { Authorization: `Bearer ${staleTokenOrgAForUserB}` },
    });
    assert.equal(staleResponse.status, 403);
  } finally {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.organization.findUnique = originalOrgFindUnique;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
    prisma.invoice.findFirst = originalInvoiceFindFirst;
    prisma.invoice.findMany = originalInvoiceFindMany;
    prisma.gmailScanItem.findMany = originalGsiFindMany;
    prisma.financialDocumentReview.findMany = originalFdrFindMany;
    prisma.supplierPayment.findMany = originalPaymentFindMany;
    prisma.$queryRawUnsafe = originalQueryRaw;
    if (previousContainment === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
    else process.env.FINANCIAL_DATA_CONTAINMENT = previousContainment;
    if (previousReadContainment === undefined) delete process.env.FINANCIAL_READ_CONTAINMENT;
    else process.env.FINANCIAL_READ_CONTAINMENT = previousReadContainment;
    if (previousIngestionContainment === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
    else process.env.FINANCIAL_INGESTION_CONTAINMENT = previousIngestionContainment;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("tenant isolation A/B — org B cannot list org A invoices", async () => {
  await withTenantIsolationHarness(async ({ baseUrl, tokenForOrgB }) => {
    const listResponse = await fetch(`${baseUrl}/invoices`, {
      headers: { Authorization: `Bearer ${tokenForOrgB}` },
    });
    assert.equal(listResponse.status, 200);
    const listBody = (await listResponse.json()) as { invoices: InvoiceRow[] };
    assert.equal(listBody.invoices.length, 0);
  });
});

test("tenant isolation A/B — direct invoice id from org A returns 404 for org B", async () => {
  await withTenantIsolationHarness(async ({ baseUrl, tokenForOrgB }) => {
    const detailResponse = await fetch(`${baseUrl}/invoices/${INVOICE_A}/status`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokenForOrgB}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "paid" }),
    });
    assert.equal(detailResponse.status, 404);
    const body = (await detailResponse.json()) as { error?: string };
    assert.equal(body.error, "Invoice not found");
  });
});

test("tampered JWT organizationId is rejected for owner accounts", async () => {
  const token = jwt.sign(
    { userId: USER_A, organizationId: ORG_B, email: "owner-a@example.com" },
    config.jwtSecret,
    { expiresIn: "1h" },
  );
  const previousContainment = process.env.FINANCIAL_DATA_CONTAINMENT;
  const previousReadContainment = process.env.FINANCIAL_READ_CONTAINMENT;
  const previousIngestionContainment = process.env.FINANCIAL_INGESTION_CONTAINMENT;
  process.env.FINANCIAL_DATA_CONTAINMENT = "0";

  const originalUserFindUnique = prisma.user.findUnique.bind(prisma.user);
  const originalOrgFindUnique = prisma.organization.findUnique.bind(prisma.organization);
  const originalMemberFindUnique = prisma.organizationMember.findUnique.bind(prisma.organizationMember);

  prisma.user.findUnique = (async () => ({
    id: USER_A,
    email: "owner-a@example.com",
    organization: { id: ORG_A },
  })) as typeof prisma.user.findUnique;
  prisma.organization.findUnique = (async (args: { where: { id: string } }) => {
    if (args.where.id === ORG_B) return { userId: USER_B };
    if (args.where.id === ORG_A) return { userId: USER_A };
    return null;
  }) as typeof prisma.organization.findUnique;
  prisma.organizationMember.findUnique = (async () => null) as typeof prisma.organizationMember.findUnique;

  const { authMiddleware } = await import("../lib/auth.js");
  const { validateTenantMiddleware } = await import("../middleware/tenantIsolation.js");
  const app = express();
  app.use(authMiddleware);
  app.use(validateTenantMiddleware);
  app.get("/invoices", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/invoices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 403);
  } finally {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.organization.findUnique = originalOrgFindUnique;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
    if (previousContainment === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
    else process.env.FINANCIAL_DATA_CONTAINMENT = previousContainment;
    if (previousReadContainment === undefined) delete process.env.FINANCIAL_READ_CONTAINMENT;
    else process.env.FINANCIAL_READ_CONTAINMENT = previousReadContainment;
    if (previousIngestionContainment === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
    else process.env.FINANCIAL_INGESTION_CONTAINMENT = previousIngestionContainment;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
