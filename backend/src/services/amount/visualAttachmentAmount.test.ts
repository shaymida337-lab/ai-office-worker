import test from "node:test";
import assert from "node:assert/strict";

import {
  invoiceScanToAttachmentAnalysis,
  mergeVisualAttachmentAnalyses,
} from "./visualAttachmentAmount.js";
import {
  buildGmailOrgAmountCandidates,
  resolveGmailOrgMoneyDecision,
} from "./amountCandidates.js";

test("invoiceScanToAttachmentAnalysis returns null when image AI has no amount", () => {
  assert.equal(
    invoiceScanToAttachmentAnalysis({
      amount: null,
      totalAmount: null,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      ocrConfidence: 0.8,
    }),
    null
  );
});

test("invoiceScanToAttachmentAnalysis preserves image AI totalAmount", () => {
  const analysis = invoiceScanToAttachmentAnalysis({
    amount: null,
    totalAmount: 1950,
    amountBeforeVat: null,
    vatAmount: null,
    currency: "ILS",
    ocrConfidence: 0.91,
  });
  assert.ok(analysis);
  assert.equal(analysis?.totalAmount, 1950);
  assert.equal(analysis?.confidence, 0.91);
});

test("resolveGmailOrgMoneyDecision uses image attachmentAnalysis like email regex fallback", () => {
  const decision = resolveGmailOrgMoneyDecision({
    organizationId: "org-1",
    documentType: "tax_invoice",
    analysis: {
      amount: null,
      totalAmount: null,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.5,
    },
    extractedFieldsAmount: null,
    regexDetectedAmount: null,
    attachmentAnalysis: {
      amount: null,
      totalAmount: 2000,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.9,
    },
  });
  assert.equal(decision.status, "resolved");
  assert.equal(decision.selectedAmount, 2000);
});

test("buildGmailOrgAmountCandidates includes claude_file source for attachmentAnalysis", () => {
  const candidates = buildGmailOrgAmountCandidates({
    analysis: {
      amount: null,
      totalAmount: null,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.5,
    },
    attachmentAnalysis: {
      amount: null,
      totalAmount: 850,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.88,
    },
  });
  assert.ok(candidates.some((candidate) => candidate.source === "claude_file" && candidate.value === 850));
});

test("mergeVisualAttachmentAnalyses keeps higher-confidence image amount", () => {
  const merged = mergeVisualAttachmentAnalyses(
    {
      amount: null,
      totalAmount: 500,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.7,
    },
    {
      amount: null,
      totalAmount: 750,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.95,
    }
  );
  assert.equal(merged?.totalAmount, 750);
});
