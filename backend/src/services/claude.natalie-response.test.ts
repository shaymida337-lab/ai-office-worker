import test from "node:test";
import assert from "node:assert/strict";

import { isNatalieClaudeResponse } from "./claude.js";

const validIssueInvoiceResponse = {
  action: "issue_invoice" as const,
  answer: "אציע טיוטת חשבונית ללקוח. לאשר?",
  proposal: {
    customerName: "Wolt",
    description: "שירות משלוחים",
    amount: 163.28,
    currency: "ILS",
    customerEmail: "billing@wolt.com",
    issueDate: "2026-06-18",
    dueDate: "2026-07-18",
  },
};

test("issue_invoice: accepts a valid proposal", () => {
  assert.equal(isNatalieClaudeResponse(validIssueInvoiceResponse), true);
});

test("issue_invoice: rejects missing customerName", () => {
  assert.equal(
    isNatalieClaudeResponse({
      ...validIssueInvoiceResponse,
      proposal: { ...validIssueInvoiceResponse.proposal, customerName: "" },
    }),
    false,
  );
});

test("issue_invoice: rejects zero amount", () => {
  assert.equal(
    isNatalieClaudeResponse({
      ...validIssueInvoiceResponse,
      proposal: { ...validIssueInvoiceResponse.proposal, amount: 0 },
    }),
    false,
  );
});

test("issue_invoice: rejects negative amount", () => {
  assert.equal(
    isNatalieClaudeResponse({
      ...validIssueInvoiceResponse,
      proposal: { ...validIssueInvoiceResponse.proposal, amount: -50 },
    }),
    false,
  );
});

test("issue_invoice: rejects missing description", () => {
  assert.equal(
    isNatalieClaudeResponse({
      ...validIssueInvoiceResponse,
      proposal: { ...validIssueInvoiceResponse.proposal, description: "" },
    }),
    false,
  );
});

test("issue_invoice: rejects string amount", () => {
  assert.equal(
    isNatalieClaudeResponse({
      ...validIssueInvoiceResponse,
      proposal: { ...validIssueInvoiceResponse.proposal, amount: "163.28" },
    }),
    false,
  );
});
