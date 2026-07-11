import test from "node:test";
import assert from "node:assert/strict";
import { displayBusinessSupplier, isEmailLike, isTechnicalText } from "./invoiceDisplay.js";
import type { Invoice } from "@/components/invoices";

const base: Invoice = {
  id: "1",
  clientId: "c1",
  invoiceNumber: null,
  amount: 100,
  currency: "ILS",
  date: "2026-01-01",
  dueDate: null,
  status: "pending",
  description: null,
  driveUrl: null,
};

test("isEmailLike detects mailbox strings", () => {
  assert.equal(isEmailLike("vendor@example.com"), true);
  assert.equal(isEmailLike("חברת אור"), false);
});

test("displayBusinessSupplier skips email-like supplier names", () => {
  const invoice: Invoice = {
    ...base,
    supplierName: "billing@vendor.co.il",
    client: { id: "c1", name: "אור תקשורת", color: null },
  };
  assert.equal(displayBusinessSupplier(invoice), "אור תקשורת");
});

test("displayBusinessSupplier hides technical descriptions", () => {
  const invoice: Invoice = {
    ...base,
    supplierName: "https://mail.google.com/mail/u/0/#inbox/abc",
  };
  assert.equal(displayBusinessSupplier(invoice), "ספק לא זוהה");
});

test("isTechnicalText treats dash placeholders as empty", () => {
  assert.equal(isTechnicalText("-"), true);
  assert.equal(isTechnicalText("—"), true);
});
