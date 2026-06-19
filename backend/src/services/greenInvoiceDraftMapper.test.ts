import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DOCUMENT_TYPE,
  DEFAULT_VAT_TYPE,
  mapDraftToGreenInvoiceDocument,
} from "./greenInvoiceDraftMapper.js";

const fullDraft = {
  customerName: "Wolt",
  customerEmail: "billing@wolt.com",
  customerTaxId: "123456789",
  description: "שירות משלוחים",
  amount: 163.28,
  currency: "ILS",
  issueDate: "2026-06-18",
};

test("mapDraftToGreenInvoiceDocument maps full draft with explicit options", () => {
  const result = mapDraftToGreenInvoiceDocument(fullDraft, {
    documentType: 400,
    language: "en",
    vatType: 1,
  });

  assert.deepEqual(result, {
    documentType: 400,
    client: {
      name: "Wolt",
      email: "billing@wolt.com",
      taxId: "123456789",
    },
    income: [
      {
        description: "שירות משלוחים",
        price: 163.28,
        quantity: 1,
        vatType: 1,
      },
    ],
    currency: "ILS",
    language: "en",
    date: "2026-06-18",
  });
});

test("mapDraftToGreenInvoiceDocument applies defaults when options are omitted", () => {
  const result = mapDraftToGreenInvoiceDocument({
    customerName: "Acme",
    description: "Consulting",
    amount: 100,
  });

  assert.equal(result.documentType, DEFAULT_DOCUMENT_TYPE);
  assert.equal(DEFAULT_DOCUMENT_TYPE, 320);
  assert.equal(result.language, "he");
  assert.equal(result.income[0]?.vatType, DEFAULT_VAT_TYPE);
  assert.equal(result.currency, "ILS");
});

test("mapDraftToGreenInvoiceDocument omits client email and taxId when missing", () => {
  const result = mapDraftToGreenInvoiceDocument({
    customerName: "Acme",
    description: "Work",
    amount: 50,
  });

  assert.equal("email" in result.client, false);
  assert.equal("taxId" in result.client, false);
  assert.equal(result.client.email, undefined);
  assert.equal(result.client.taxId, undefined);
});

test("mapDraftToGreenInvoiceDocument throws when customerName is empty or missing", () => {
  assert.throws(
    () =>
      mapDraftToGreenInvoiceDocument({
        customerName: "",
        description: "Work",
        amount: 50,
      }),
    /customerName is required/
  );

  assert.throws(
    () =>
      mapDraftToGreenInvoiceDocument({
        description: "Work",
        amount: 50,
      } as { customerName: string; description: string; amount: number }),
    /customerName is required/
  );
});

test("mapDraftToGreenInvoiceDocument omits date when issueDate is missing", () => {
  const result = mapDraftToGreenInvoiceDocument({
    customerName: "Acme",
    description: "Work",
    amount: 50,
  });

  assert.equal("date" in result, false);
  assert.equal(result.date, undefined);
});
