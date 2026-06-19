import test from "node:test";
import assert from "node:assert/strict";

import { mapDraftToGreenInvoiceDocument } from "./greenInvoiceDraftMapper.js";
import type { GreenInvoiceCreatedDocument } from "./green-invoice.js";
import { issueDraftToGreenInvoice } from "./greenInvoiceIssuer.js";

const baseDraft = {
  id: "draft-1",
  customerName: "Wolt",
  customerEmail: "billing@wolt.com",
  customerTaxId: "123456789",
  description: "שירות משלוחים",
  amount: 163.28,
  currency: "ILS",
  issueDate: "2026-06-18",
  approvedAt: new Date("2026-06-18T10:00:00.000Z"),
  greenInvoiceDocumentId: null,
};

const sandboxOrganization = {
  greenInvoiceEnv: "sandbox",
  greenInvoiceApiKeyId: "key-id",
  greenInvoiceApiSecret: "key-secret",
};

function createDeps(overrides?: {
  createDocumentResult?: GreenInvoiceCreatedDocument;
}) {
  let createDocumentCallCount = 0;
  const createDocumentCalls: Array<{
    apiKeyId: string;
    apiSecret: string;
    env: string;
    params: unknown;
  }> = [];
  let saveDocumentIdCallCount = 0;
  const saveDocumentIdCalls: Array<[string, string]> = [];

  const createDocumentResult = overrides?.createDocumentResult ?? {
    id: "gi-doc-1",
    raw: {},
  };

  const deps = {
    createDocument: async (
      apiKeyId: string,
      apiSecret: string,
      env: "sandbox" | "production",
      params: unknown
    ) => {
      createDocumentCallCount += 1;
      createDocumentCalls.push({ apiKeyId, apiSecret, env, params });
      return createDocumentResult;
    },
    saveDocumentId: async (draftId: string, documentId: string) => {
      saveDocumentIdCallCount += 1;
      saveDocumentIdCalls.push([draftId, documentId]);
    },
  };

  return {
    deps,
    createDocumentCallCount: () => createDocumentCallCount,
    createDocumentCalls: () => createDocumentCalls,
    saveDocumentIdCallCount: () => saveDocumentIdCallCount,
    saveDocumentIdCalls: () => saveDocumentIdCalls,
  };
}

test("issueDraftToGreenInvoice issues approved sandbox draft via injected deps", async () => {
  const options = { documentType: 400, language: "en" as const, vatType: 1 };
  const { deps, createDocumentCallCount, createDocumentCalls, saveDocumentIdCallCount, saveDocumentIdCalls } =
    createDeps();

  const result = await issueDraftToGreenInvoice(baseDraft, sandboxOrganization, deps, options);

  assert.equal(createDocumentCallCount(), 1);
  assert.equal(createDocumentCalls()[0]?.env, "sandbox");
  assert.deepEqual(createDocumentCalls()[0]?.params, mapDraftToGreenInvoiceDocument(baseDraft, options));
  assert.equal(saveDocumentIdCallCount(), 1);
  assert.deepEqual(saveDocumentIdCalls()[0], ["draft-1", "gi-doc-1"]);
  assert.deepEqual(result, { id: "gi-doc-1", raw: {} });
});

test("issueDraftToGreenInvoice rejects production environment", async () => {
  const { deps, createDocumentCallCount } = createDeps();

  await assert.rejects(
    () =>
      issueDraftToGreenInvoice(baseDraft, { ...sandboxOrganization, greenInvoiceEnv: "production" }, deps),
    /sandbox/i
  );

  assert.equal(createDocumentCallCount(), 0);
});

test("issueDraftToGreenInvoice rejects missing credentials", async () => {
  const { deps, createDocumentCallCount } = createDeps();

  await assert.rejects(
    () =>
      issueDraftToGreenInvoice(baseDraft, { ...sandboxOrganization, greenInvoiceApiKeyId: null }, deps),
    /credentials/i
  );

  await assert.rejects(
    () =>
      issueDraftToGreenInvoice(baseDraft, { ...sandboxOrganization, greenInvoiceApiSecret: "" }, deps),
    /credentials/i
  );

  assert.equal(createDocumentCallCount(), 0);
});

test("issueDraftToGreenInvoice rejects unapproved draft", async () => {
  const { deps, createDocumentCallCount } = createDeps();

  await assert.rejects(
    () => issueDraftToGreenInvoice({ ...baseDraft, approvedAt: null }, sandboxOrganization, deps),
    /must be approved/i
  );

  assert.equal(createDocumentCallCount(), 0);
});

test("issueDraftToGreenInvoice rejects already issued draft", async () => {
  const { deps, createDocumentCallCount } = createDeps();

  await assert.rejects(
    () =>
      issueDraftToGreenInvoice(
        { ...baseDraft, greenInvoiceDocumentId: "existing-doc" },
        sandboxOrganization,
        deps
      ),
    /already issued/i
  );

  assert.equal(createDocumentCallCount(), 0);
});

test("issueDraftToGreenInvoice rejects createDocument result without id", async () => {
  const { deps, createDocumentCallCount, saveDocumentIdCallCount } = createDeps({
    createDocumentResult: { raw: {} },
  });

  await assert.rejects(
    () => issueDraftToGreenInvoice(baseDraft, sandboxOrganization, deps),
    /document id/i
  );

  assert.equal(createDocumentCallCount(), 1);
  assert.equal(saveDocumentIdCallCount(), 0);
});
