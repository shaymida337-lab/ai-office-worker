import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackMonthGroups,
  monthKeyFromParts,
  resolveInvoiceGroupingDate,
  type InvoiceGroupingInput,
} from "./monthGrouping.js";

function invoice(overrides: Partial<InvoiceGroupingInput> & Pick<InvoiceGroupingInput, "date">): InvoiceGroupingInput {
  return {
    amount: 100,
    currency: "ILS",
    ...overrides,
  };
}

test("resolveInvoiceGroupingDate prefers normalizedDocumentDate over invoice date", () => {
  const resolved = resolveInvoiceGroupingDate(
    invoice({
      date: "2026-03-15T00:00:00.000Z",
      normalizedDocumentDate: "2026-01-10T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    }),
  );
  assert.equal(resolved?.toISOString(), new Date("2026-01-10T00:00:00.000Z").toISOString());
});

test("resolveInvoiceGroupingDate uses invoice date for persisted invoices when normalized date missing", () => {
  const resolved = resolveInvoiceGroupingDate(
    invoice({
      source: "invoice",
      date: "2026-04-20T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    }),
  );
  assert.equal(resolved?.toISOString(), new Date("2026-04-20T00:00:00.000Z").toISOString());
});

test("resolveInvoiceGroupingDate uses document date for review candidates", () => {
  const resolved = resolveInvoiceGroupingDate(
    invoice({
      source: "financial_document_review",
      date: "2026-05-12T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    }),
  );
  assert.equal(resolved?.toISOString(), new Date("2026-05-12T00:00:00.000Z").toISOString());
});

test("resolveInvoiceGroupingDate falls back to createdAt then updatedAt", () => {
  const fromCreated = resolveInvoiceGroupingDate(
    invoice({
      source: "financial_document_review",
      date: "",
      createdAt: "2026-02-08T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }),
  );
  assert.equal(fromCreated?.toISOString(), new Date("2026-02-08T00:00:00.000Z").toISOString());

  const fromUpdated = resolveInvoiceGroupingDate(
    invoice({
      source: "financial_document_review",
      date: "",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }),
  );
  assert.equal(fromUpdated?.toISOString(), new Date("2026-07-01T00:00:00.000Z").toISOString());
});

test("buildFallbackMonthGroups splits invoices by month when normalizedDocumentDate is missing", () => {
  const rows = [
    invoice({
      source: "invoice",
      date: "2026-03-10T00:00:00.000Z",
      amount: 120,
    }),
    invoice({
      source: "invoice",
      date: "2026-03-22T00:00:00.000Z",
      amount: 80,
    }),
    invoice({
      source: "financial_document_review",
      date: "2026-01-05T00:00:00.000Z",
      amount: 50,
    }),
    invoice({
      source: "gmail_scan_item",
      date: "2026-01-18T00:00:00.000Z",
      amount: 30,
    }),
  ];

  const { months, invoicesByMonth } = buildFallbackMonthGroups(rows);

  assert.deepEqual(
    months.map((month) => monthKeyFromParts(month.year, month.month)),
    ["2026-03", "2026-01"],
  );
  assert.equal(months[0]?.count, 2);
  assert.equal(months[0]?.totalsByCurrency.ILS, 200);
  assert.equal(months[1]?.count, 2);
  assert.equal(months[1]?.totalsByCurrency.ILS, 80);
  assert.equal(invoicesByMonth["2026-03"]?.length, 2);
  assert.equal(invoicesByMonth["2026-01"]?.length, 2);
});

test("buildFallbackMonthGroups groups by createdAt when document dates are absent", () => {
  const { months, invoicesByMonth } = buildFallbackMonthGroups([
    invoice({
      source: "financial_document_review",
      date: "",
      createdAt: "2026-06-15T00:00:00.000Z",
      amount: 10,
    }),
    invoice({
      source: "financial_document_review",
      date: "",
      createdAt: "2026-06-28T00:00:00.000Z",
      amount: 20,
    }),
    invoice({
      source: "financial_document_review",
      date: "",
      createdAt: "2026-05-02T00:00:00.000Z",
      amount: 30,
    }),
  ]);

  assert.deepEqual(
    months.map((month) => monthKeyFromParts(month.year, month.month)),
    ["2026-06", "2026-05"],
  );
  assert.equal(invoicesByMonth["2026-06"]?.length, 2);
  assert.equal(invoicesByMonth["2026-05"]?.length, 1);
});
