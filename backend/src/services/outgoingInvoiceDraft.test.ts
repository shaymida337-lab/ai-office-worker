import test from "node:test";
import assert from "node:assert/strict";

import { validateInvoiceDraftInput } from "./outgoingInvoiceDraft.js";

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
