import test from "node:test";
import assert from "node:assert/strict";

import type { GreenInvoiceCreatedDocument } from "./green-invoice.js";
import { issueDraftHandler } from "./greenInvoiceIssueHandler.js";

const draftId = "draft-abc";
const organizationId = "org-1";

const approvedDraft = {
  id: draftId,
  customerName: "Acme",
  description: "Consulting",
  amount: 100,
  approvedAt: new Date("2026-06-18T10:00:00.000Z"),
  greenInvoiceDocumentId: null,
};

const sandboxOrganization = {
  greenInvoiceEnv: "sandbox",
  greenInvoiceApiKeyId: "k",
  greenInvoiceApiSecret: "s",
};

function createSpies(createDocumentResult: GreenInvoiceCreatedDocument = { id: "DOC123", raw: {} }) {
  let createDocumentCallCount = 0;
  let saveDocumentIdCallCount = 0;
  const saveDocumentIdCalls: Array<[string, string]> = [];
  const loadDraftCalls: Array<[string, string]> = [];
  const loadOrganizationCalls: string[] = [];

  const createDocument = async () => {
    createDocumentCallCount += 1;
    return createDocumentResult;
  };

  const saveDocumentId = async (id: string, documentId: string) => {
    saveDocumentIdCallCount += 1;
    saveDocumentIdCalls.push([id, documentId]);
  };

  return {
    createDocumentCallCount: () => createDocumentCallCount,
    saveDocumentIdCallCount: () => saveDocumentIdCallCount,
    saveDocumentIdCalls: () => saveDocumentIdCalls,
    loadDraftCalls: () => loadDraftCalls,
    loadOrganizationCalls: () => loadOrganizationCalls,
    handlerDeps: {
      draftId,
      organizationId,
      loadDraft: async (id: string, orgId: string) => {
        loadDraftCalls.push([id, orgId]);
        return approvedDraft;
      },
      loadOrganization: async (orgId: string) => {
        loadOrganizationCalls.push(orgId);
        return sandboxOrganization;
      },
      createDocument,
      saveDocumentId,
    },
  };
}

test("issueDraftHandler returns 404 when draft is missing", async () => {
  let createDocumentCallCount = 0;

  const result = await issueDraftHandler({
    draftId,
    organizationId,
    loadDraft: async () => null,
    loadOrganization: async () => sandboxOrganization,
    createDocument: async () => {
      createDocumentCallCount += 1;
      return { id: "DOC123", raw: {} };
    },
    saveDocumentId: async () => {},
  });

  assert.equal(result.status, 404);
  assert.equal(result.body.success, false);
  if (!result.body.success) assert.equal(result.body.error, "draft not found");
  assert.equal(createDocumentCallCount, 0);
});

test("issueDraftHandler returns 400 when organization is missing", async () => {
  let createDocumentCallCount = 0;

  const result = await issueDraftHandler({
    draftId,
    organizationId,
    loadDraft: async () => approvedDraft,
    loadOrganization: async () => null,
    createDocument: async () => {
      createDocumentCallCount += 1;
      return { id: "DOC123", raw: {} };
    },
    saveDocumentId: async () => {},
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
  if (!result.body.success) assert.equal(result.body.error, "organization not found");
  assert.equal(createDocumentCallCount, 0);
});

test("issueDraftHandler issues approved sandbox draft successfully", async () => {
  const spies = createSpies();

  const result = await issueDraftHandler(spies.handlerDeps);

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  if (result.body.success) {
    assert.equal(result.body.documentId, "DOC123");
    assert.deepEqual(result.body.document, { id: "DOC123", raw: {} });
  }
  assert.equal(spies.createDocumentCallCount(), 1);
  assert.equal(spies.saveDocumentIdCallCount(), 1);
  assert.deepEqual(spies.saveDocumentIdCalls()[0], [draftId, "DOC123"]);
});

test("issueDraftHandler returns 400 when issuer throws", async () => {
  let createDocumentCallCount = 0;

  const result = await issueDraftHandler({
    draftId,
    organizationId,
    loadDraft: async () => approvedDraft,
    loadOrganization: async () => ({
      greenInvoiceEnv: "production",
      greenInvoiceApiKeyId: "k",
      greenInvoiceApiSecret: "s",
    }),
    createDocument: async () => {
      createDocumentCallCount += 1;
      return { id: "DOC123", raw: {} };
    },
    saveDocumentId: async () => {},
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
  if (!result.body.success) {
    assert.equal(typeof result.body.error, "string");
    assert.match(result.body.error, /sandbox/i);
  }
  assert.equal(createDocumentCallCount, 0);
});

test("issueDraftHandler scopes loadDraft to the provided draftId and organizationId", async () => {
  const spies = createSpies();
  const requestedDraftId = "draft-requested";
  const requestedOrganizationId = "org-requested";

  await issueDraftHandler({
    ...spies.handlerDeps,
    draftId: requestedDraftId,
    organizationId: requestedOrganizationId,
  });

  assert.deepEqual(spies.loadDraftCalls(), [[requestedDraftId, requestedOrganizationId]]);
  assert.deepEqual(spies.loadOrganizationCalls(), [requestedOrganizationId]);
});
