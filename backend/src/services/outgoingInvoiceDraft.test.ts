import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import {
  validateInvoiceDraftInput,
  filterValidInvoiceDrafts,
  listOutgoingInvoiceDrafts,
  deleteOutgoingInvoiceDraft,
} from "./outgoingInvoiceDraft.js";

const validInput = {
  customerName: "Wolt",
  description: "שירות משלוחים",
  amount: 163.28,
  currency: "ILS",
  customerEmail: "billing@wolt.com",
  customerTaxId: "123456789",
  issueDate: "2026-06-18",
  dueDate: "2026-07-18",
};

test("validateInvoiceDraftInput accepts a full valid input", () => {
  const result = validateInvoiceDraftInput(validInput);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.customerName, "Wolt");
    assert.equal(result.value.amount, 163.28);
  }
});

test("validateInvoiceDraftInput rejects missing customerName", () => {
  const result = validateInvoiceDraftInput({ ...validInput, customerName: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "customer name required");
});

test("validateInvoiceDraftInput rejects zero amount", () => {
  const result = validateInvoiceDraftInput({ ...validInput, amount: 0 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "amount must be positive");
});

test("validateInvoiceDraftInput rejects negative amount", () => {
  const result = validateInvoiceDraftInput({ ...validInput, amount: -10 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "amount must be positive");
});

test("validateInvoiceDraftInput rejects missing description", () => {
  const result = validateInvoiceDraftInput({ ...validInput, description: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "description required");
});

test("validateInvoiceDraftInput rejects non-string customerEmail", () => {
  const result = validateInvoiceDraftInput({ ...validInput, customerEmail: 123 });
  assert.equal(result.ok, false);
});

test("filterValidInvoiceDrafts keeps only valid drafts", () => {
  const valid = filterValidInvoiceDrafts([
    validInput,
    { ...validInput, customerName: "" },
    { ...validInput, amount: -5 },
    { customerName: "OK", description: "desc", amount: 10 },
  ]);

  assert.equal(valid.length, 2);
  assert.equal(valid[0]?.customerName, "Wolt");
  assert.equal(valid[1]?.customerName, "OK");
});

test("listOutgoingInvoiceDrafts scopes by organizationId", async () => {
  const original = prisma.outgoingInvoiceDraft.findMany.bind(prisma.outgoingInvoiceDraft);
  let capturedArgs: Parameters<typeof prisma.outgoingInvoiceDraft.findMany>[0];
  prisma.outgoingInvoiceDraft.findMany = (async (args) => {
    capturedArgs = args;
    return [];
  }) as typeof prisma.outgoingInvoiceDraft.findMany;
  try {
    await listOutgoingInvoiceDrafts({ organizationId: "org-1" });
    assert.deepEqual(capturedArgs!.where, { organizationId: "org-1" });
    assert.deepEqual(capturedArgs!.orderBy, { createdAt: "desc" });
  } finally {
    prisma.outgoingInvoiceDraft.findMany = original;
  }
});

test("deleteOutgoingInvoiceDraft returns deleted false when draft is missing", async () => {
  const original = prisma.outgoingInvoiceDraft.deleteMany.bind(prisma.outgoingInvoiceDraft);
  prisma.outgoingInvoiceDraft.deleteMany = (async () => ({ count: 0 })) as typeof prisma.outgoingInvoiceDraft.deleteMany;
  try {
    const result = await deleteOutgoingInvoiceDraft({ organizationId: "org-1", id: "draft-1" });
    assert.equal(result.deleted, false);
  } finally {
    prisma.outgoingInvoiceDraft.deleteMany = original;
  }
});

test("deleteOutgoingInvoiceDraft deletes only within organization scope", async () => {
  const original = prisma.outgoingInvoiceDraft.deleteMany.bind(prisma.outgoingInvoiceDraft);
  let capturedWhere: unknown;
  prisma.outgoingInvoiceDraft.deleteMany = (async (args) => {
    capturedWhere = args?.where;
    return { count: 1 };
  }) as typeof prisma.outgoingInvoiceDraft.deleteMany;
  try {
    const result = await deleteOutgoingInvoiceDraft({ organizationId: "org-1", id: "draft-1" });
    assert.equal(result.deleted, true);
    assert.deepEqual(capturedWhere, { id: "draft-1", organizationId: "org-1" });
  } finally {
    prisma.outgoingInvoiceDraft.deleteMany = original;
  }
});
