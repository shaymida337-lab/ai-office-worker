import test from "node:test";
import assert from "node:assert/strict";
import { classifyBusinessDocument, pipelineActionForClassification } from "./classifier.js";

test("supplier invoice from OpenAI is outgoing supplier and classified", () => {
  const result = classifyBusinessDocument({
    sender: "billing@openai.com",
    subject: "Invoice INV-1001 from OpenAI",
    body: "Your OpenAI subscription invoice is attached.",
    documentType: "invoice",
    supplierName: "OpenAI",
    businessName: "AI Office Worker Ltd",
    issuedBy: "OpenAI",
    issuedTo: "AI Office Worker Ltd",
    paymentRequired: true,
  });

  assert.equal(result.direction, "OUTGOING");
  assert.equal(result.party, "SUPPLIER");
  assert.equal(result.isRealSupplier, "REAL_SUPPLIER");
  assert.equal(result.decision, "CLASSIFIED");
  assert.equal(pipelineActionForClassification(result), "SUPPLIER_EXPENSE");
});

test("supplier invoice from hardware store is outgoing supplier and classified", () => {
  const result = classifyBusinessDocument({
    sender: "invoices@hardware-store.example",
    subject: "חשבונית ספק חומרי בניין",
    body: "חשבונית מאת חנות חומרי בניין עבור רכישה.",
    documentType: "tax_invoice",
    supplierName: "Hardware Store",
    businessName: "AI Office Worker Ltd",
    issuedBy: "Hardware Store",
    issuedTo: "AI Office Worker Ltd",
  });

  assert.equal(result.direction, "OUTGOING");
  assert.equal(result.party, "SUPPLIER");
  assert.equal(result.isRealSupplier, "REAL_SUPPLIER");
  assert.equal(result.decision, "CLASSIFIED");
  assert.equal(pipelineActionForClassification(result), "SUPPLIER_EXPENSE");
});

test("customer paying the business is incoming customer and classified", () => {
  const result = classifyBusinessDocument({
    sender: "billing@ai-office.example",
    subject: "Customer invoice INV-2001",
    body: "Sales invoice issued to Moshe Cohen. Payment received.",
    documentType: "invoice",
    customerName: "Moshe Cohen",
    businessName: "AI Office Worker Ltd",
    issuedBy: "AI Office Worker Ltd",
    issuedTo: "Moshe Cohen",
  });

  assert.equal(result.direction, "INCOMING");
  assert.equal(result.party, "CUSTOMER");
  assert.equal(result.isRealSupplier, "NOT_APPLICABLE");
  assert.equal(result.decision, "CLASSIFIED");
  assert.equal(pipelineActionForClassification(result), "CUSTOMER_INVOICE");
});

test("bank statement is blocklisted and never supplier or customer", () => {
  const result = classifyBusinessDocument({
    sender: "statements@bank.example",
    subject: "Monthly bank statement",
    body: "Your bank statement and credit card charges are ready.",
    documentType: "statement",
    businessName: "AI Office Worker Ltd",
  });

  assert.equal(result.direction, "UNSURE");
  assert.equal(result.party, "NONE");
  assert.equal(result.isRealSupplier, "BLOCKLISTED");
  assert.equal(result.decision, "NEEDS_REVIEW");
  assert.equal(pipelineActionForClassification(result), "NEEDS_REVIEW");
});

test("ambiguous money direction goes to review", () => {
  const result = classifyBusinessDocument({
    sender: "someone@example.com",
    subject: "Document",
    body: "Please review this document.",
    documentType: "document",
    businessName: "AI Office Worker Ltd",
  });

  assert.equal(result.direction, "UNSURE");
  assert.equal(result.party, "NONE");
  assert.equal(result.decision, "NEEDS_REVIEW");
  assert.equal(pipelineActionForClassification(result), "NEEDS_REVIEW");
});

test("supplier is never returned as customer", () => {
  const result = classifyBusinessDocument({
    sender: "billing@openai.com",
    subject: "Invoice from OpenAI",
    body: "Subscription invoice for your account.",
    documentType: "invoice",
    supplierName: "OpenAI",
    businessName: "AI Office Worker Ltd",
    issuedBy: "OpenAI",
    issuedTo: "AI Office Worker Ltd",
  });

  assert.equal(result.party, "SUPPLIER");
  assert.notEqual(result.party, "CUSTOMER");
  assert.equal(result.direction, "OUTGOING");
});
