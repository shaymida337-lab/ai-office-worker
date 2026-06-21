import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFinancialSnapshot,
  buildReprocessComparison,
  financialSnapshotsEqual,
  reprocessFinancialDocumentBySource,
  type ReprocessFinancialDocumentDeps,
} from "./reprocessFinancialDocument.js";

test("financialSnapshotsEqual treats matching supplier, amount, and date as unchanged", () => {
  const snapshot = buildFinancialSnapshot({
    supplier: "Acme Ltd",
    amount: 120,
    date: new Date("2024-06-01T12:00:00.000Z"),
  });
  assert.equal(financialSnapshotsEqual(snapshot, { ...snapshot }), true);
});

test("buildReprocessComparison flags supplier and amount changes", () => {
  const before = buildFinancialSnapshot({
    supplier: "FieldsFromText",
    amount: 0,
    date: new Date("2024-06-01"),
  });
  const after = buildFinancialSnapshot({
    supplier: "חברת החשמל",
    amount: 486.5,
    date: new Date("2024-06-01"),
  });
  const comparison = buildReprocessComparison(before, after);
  assert.equal(comparison.wouldChange, true);
  assert.equal(comparison.before.supplier, "FieldsFromText");
  assert.equal(comparison.after.amount, 486.5);
});

test("reprocessFinancialDocumentBySource dryRun performs no prisma writes", async () => {
  const writes: string[] = [];
  const mockPrisma = {
    gmailScanItem: {
      findFirst: async () => ({
        id: "gsi-1",
        gmailMessageId: "gm-1",
        emailMessageId: "em-1",
        supplierName: "FieldsFromText",
        amount: 0,
        occurredAt: new Date("2024-01-15T00:00:00.000Z"),
      }),
      update: async () => {
        writes.push("gmailScanItem.update");
      },
    },
    invoice: {
      update: async () => {
        writes.push("invoice.update");
      },
    },
    financialDocumentReview: {
      update: async () => {
        writes.push("financialDocumentReview.update");
      },
    },
  };

  const result = await reprocessFinancialDocumentBySource(
    {
      organizationId: "org-1",
      gmailScanItemId: "gsi-1",
      dryRun: true,
    },
    {
      prismaClient: mockPrisma as unknown as ReprocessFinancialDocumentDeps["prismaClient"],
      getGoogleClientsFn: (async () => ({ gmail: {} as never, drive: {} as never, sheets: {} as never, oauth2: {} as never })) as ReprocessFinancialDocumentDeps["getGoogleClientsFn"],
      parseGmailMessage: async () => ({
        supplierName: "חברת החשמל",
        amount: 486.5,
        finalTotalAmount: 486.5,
        documentDate: new Date("2024-01-15T00:00:00.000Z"),
        invoiceNumber: "INV-100",
      }),
    }
  );

  assert.equal(writes.length, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.updated, false);
  assert.equal(result.wouldChange, true);
  assert.equal(result.before.supplier, "FieldsFromText");
  assert.equal(result.before.amount, 0);
  assert.equal(result.after.supplier, "חברת החשמל");
  assert.equal(result.after.amount, 486.5);
});

test("reprocessFinancialDocumentBySource dryRun=false updates in place by id", async () => {
  const updates: Array<{ table: string; id: string; data: Record<string, unknown> }> = [];
  const mockPrisma = {
    gmailScanItem: {
      findFirst: async () => ({
        id: "gsi-2",
        gmailMessageId: "gm-2",
        emailMessageId: "em-2",
        supplierName: "junk",
        amount: 1_000_000,
        occurredAt: new Date("2024-03-01T00:00:00.000Z"),
      }),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ table: "gmailScanItem", id: where.id, data });
      },
    },
    invoice: { update: async () => undefined },
    financialDocumentReview: { update: async () => undefined },
  };

  const result = await reprocessFinancialDocumentBySource(
    {
      organizationId: "org-1",
      gmailScanItemId: "gsi-2",
      dryRun: false,
    },
    {
      prismaClient: mockPrisma as unknown as ReprocessFinancialDocumentDeps["prismaClient"],
      getGoogleClientsFn: (async () => ({ gmail: {} as never, drive: {} as never, sheets: {} as never, oauth2: {} as never })) as ReprocessFinancialDocumentDeps["getGoogleClientsFn"],
      parseGmailMessage: async () => ({
        supplierName: "Netlify",
        amount: 49,
        finalTotalAmount: 49,
        documentDate: new Date("2024-03-01T00:00:00.000Z"),
        invoiceNumber: null,
      }),
    }
  );

  assert.equal(result.updated, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.table, "gmailScanItem");
  assert.equal(updates[0]?.id, "gsi-2");
  assert.equal(updates[0]?.data.supplierName, "Netlify");
  assert.equal(updates[0]?.data.amount, 49);
});
