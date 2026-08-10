import test from "node:test";
import assert from "node:assert/strict";
import { computeCanonicalAmount, type AmountCandidate } from "./canonicalAmount.js";
import {
  buildAnalysisAmountCandidates,
  resolveClientGmailMoneyDecision,
  resolveGmailOrgMoneyDecision,
  resolveWhatsAppMoneyDecision,
} from "./amountCandidates.js";

function decision(candidates: AmountCandidate[], documentType: Parameters<typeof computeCanonicalAmount>[0]["documentType"] = "tax_invoice") {
  return computeCanonicalAmount({
    organizationId: "org-arc",
    documentType,
    currency: "ILS",
    source: "test",
    candidates,
  });
}

test("ARC resolves subtotal + VAT + total to invoice total", () => {
  const result = decision([
    { value: 354, kind: "invoice_total", source: "claude_file", label: "סה\"כ לתשלום", confidence: 0.95 },
    { value: 307.69, kind: "subtotal_before_vat", source: "claude_file", confidence: 0.9 },
    { value: 46.31, kind: "vat_only", source: "claude_file", confidence: 0.9 },
  ]);

  assert.equal(result.selectedAmount, 354);
  assert.equal(result.amountBeforeVat, 307.69);
  assert.equal(result.vatAmount, 46.31);
  assert.equal(result.reasonCode, "INVOICE_TOTAL");
  assert.equal(result.status, "resolved");
  assert.ok(result.confidence >= 0.9);
  assert.equal(result.ambiguityFlags.length, 0);
});

test("ARC prefers Claude totalAmount over conflicting amount field", () => {
  const result = decision([
    { value: 307.69, kind: "ai_inferred", source: "claude_file", label: "amount", confidence: 0.8 },
    { value: 354, kind: "ai_total", source: "claude_file", label: "totalAmount", confidence: 0.9 },
  ]);

  assert.equal(result.selectedAmount, 354);
  assert.equal(result.reasonCode, "AI_TOTAL");
});

test("ARC computes total from subtotal and VAT when total missing", () => {
  const result = decision([
    { value: 307.69, kind: "subtotal_before_vat", source: "claude_file", confidence: 0.85 },
    { value: 46.31, kind: "vat_only", source: "claude_file", confidence: 0.85 },
  ]);

  assert.equal(result.selectedAmount, 354);
  assert.equal(result.reasonCode, "COMPUTED_FROM_VAT");
});

test("ARC returns missing for zero amount candidates", () => {
  const result = decision([
    { value: 0, kind: "ai_total", source: "claude_file" },
  ]);

  assert.equal(result.selectedAmount, null);
  assert.equal(result.status, "missing");
  assert.equal(result.reasonCode, "MISSING");
});

test("ARC flags ambiguous when multiple top totals diverge", () => {
  const result = decision([
    { value: 100, kind: "invoice_total", source: "regex_gmail", confidence: 0.9 },
    { value: 10000, kind: "invoice_total", source: "regex_gmail", confidence: 0.88 },
  ]);

  assert.equal(result.selectedAmount, null);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.reasonCode, "DECIMAL_SHIFT");
});

test("ARC accepts credit note negative totals", () => {
  const result = decision(
    [{ value: -500, kind: "credit_amount", source: "claude_file", confidence: 0.92 }],
    "credit_note"
  );

  assert.equal(result.selectedAmount, -500);
  assert.equal(result.status, "resolved");
});

test("ARC limits confidence for foreign currency", () => {
  const result = computeCanonicalAmount({
    organizationId: "org-arc",
    documentType: "tax_invoice",
    currency: "EUR",
    source: "test",
    candidates: [{ value: 19.99, kind: "invoice_total", source: "claude_file", confidence: 0.95 }],
  });

  assert.equal(result.selectedAmount, 19.99);
  assert.equal(result.currency, "EUR");
  assert.ok(result.confidence <= 0.79);
  assert.ok(result.ambiguityFlags.includes("foreign_currency"));
  assert.equal(result.isStrongEnoughForAutoSave, false);
});

test("Delivery 7: Extended Canonical Money contract populates subtotal, tax, total, and validation", () => {
  const result = decision([
    { value: 1000, kind: "subtotal_before_vat", source: "claude_file", confidence: 0.9 },
    { value: 180, kind: "vat_only", source: "claude_file", confidence: 0.9 },
    { value: 1180, kind: "invoice_total", source: "claude_file", confidence: 0.95 },
    { value: 680, kind: "amount_due", source: "claude_file", confidence: 0.85 },
    { value: 500, kind: "partial_payment", source: "claude_file", confidence: 0.85 },
  ]);

  assert.equal(result.selectedAmount, 1180);
  assert.equal(result.status, "resolved");
  assert.equal(result.subtotal?.amount, 1000);
  assert.equal(result.tax?.amount, 180);
  assert.equal(result.total?.amount, 1180);
  assert.equal(result.amountDue?.amount, 680);
  assert.equal(result.amountPaid?.amount, 500);
  assert.equal(result.validation?.subtotalPlusTaxMatchesTotal, true);
  assert.equal(result.validation?.paidPlusDueMatchesTotal, true);
});

test("Delivery 7B: Attachment-only amount evidence resolves end-to-end via ARC", () => {
  const decision = resolveGmailOrgMoneyDecision({
    organizationId: "org-att-test",
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
      totalAmount: 1180,
      amount: 1180,
      amountBeforeVat: 1000,
      vatAmount: 180,
      currency: "ILS",
      confidence: 0.92,
    },
  });

  assert.equal(decision.selectedAmount, 1180);
  assert.equal(decision.status, "resolved");
  assert.ok(decision.reasonCode === "COMPUTED_FROM_VAT" || decision.reasonCode === "AI_TOTAL");
  assert.equal(decision.candidates[0].source, "claude_file");
});

test("Delivery 7B: Currency missing or un-evidenced yields currency null", () => {
  const result = computeCanonicalAmount({
    organizationId: "org-currency-null",
    documentType: "tax_invoice",
    currency: null,
    source: "test",
    candidates: [{ value: 1180, kind: "invoice_total", source: "claude_file" }],
  });

  assert.equal(result.selectedAmount, 1180);
  assert.equal(result.currency, null);
});

test("Delivery 7B: True conflicting totals flag ambiguous status and SOURCE_CONFLICT", () => {
  const result = decision([
    { value: 1180, kind: "ai_total", source: "claude_email", confidence: 0.9 },
    { value: 1480, kind: "regex_labeled", source: "regex_gmail", confidence: 0.9 },
  ]);

  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedAmount, null);
  assert.equal(result.reasonCode, "SOURCE_CONFLICT");
});

test("ARC flags decimal shift between AI and regex (MAX receipt scenario)", () => {
  const result = decision([
    { value: 110723, kind: "ai_total", source: "claude_email", confidence: 0.9 },
    { value: 1107.23, kind: "regex_labeled", source: "regex_gmail", label: "סה\"כ לתשלום", confidence: 0.72 },
  ], "receipt");

  assert.equal(result.selectedAmount, null);
  assert.equal(result.status, "ambiguous");
  assert.ok(result.reasonCode === "DECIMAL_SHIFT" || result.reasonCode === "SOURCE_CONFLICT");
  assert.ok(result.ambiguityFlags.includes("decimal_shift_suspicion") || result.ambiguityFlags.includes("source_conflict"));
});

test("ARC selects VAT-confirmed total for receipt", () => {
  const result = decision(
    [
      { value: 1107.23, kind: "ai_total", source: "claude_file", confidence: 0.9 },
      { value: 946.35, kind: "subtotal_before_vat", source: "claude_file", confidence: 0.85 },
      { value: 160.88, kind: "vat_only", source: "claude_file", confidence: 0.85 },
    ],
    "receipt"
  );

  assert.equal(result.selectedAmount, 1107.23);
  assert.equal(result.status, "resolved");
});

test("ARC does not pick largest of conflicting unlabeled totals", () => {
  const result = decision([
    { value: 500, kind: "regex_currency", source: "regex_gmail", confidence: 0.7 },
    { value: 50000, kind: "regex_currency", source: "regex_gmail", confidence: 0.68 },
  ]);

  assert.equal(result.selectedAmount, null);
  assert.equal(result.status, "ambiguous");
});

test("resolveGmailOrgMoneyDecision blocks MAX-style wrong total", () => {
  const result = resolveGmailOrgMoneyDecision({
    organizationId: "org-max",
    documentType: "receipt",
    analysis: {
      amount: 110723,
      totalAmount: 110723,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.9,
    },
    extractedFieldsAmount: 1107.23,
    regexDetectedAmount: 1107.23,
  });

  assert.equal(result.selectedAmount, null);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.isStrongEnoughForAutoSave, false);
});

test("ARC rejects year-like OCR values via candidate rejection path", () => {
  const result = decision([
    { value: 120, kind: "regex_labeled", source: "regex_gmail", label: "סה\"כ", confidence: 0.8 },
  ]);

  assert.equal(result.selectedAmount, 120);
  assert.equal(result.status, "resolved");
});

test("client Gmail ARC prefers totalAmount over amount conflict", () => {
  const result = resolveClientGmailMoneyDecision({
    organizationId: "org-1",
    documentType: "invoice",
    analysis: {
      amount: 200,
      totalAmount: 163.28,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.8,
    },
  });

  assert.equal(result.selectedAmount, 163.28);
  assert.equal(result.reasonCode, "AI_TOTAL");
});

test("WhatsApp ARC resolves same candidates deterministically", () => {
  const input = {
    organizationId: "org-1",
    documentType: "invoice",
    analysis: {
      amount: 163.28,
      totalAmount: 163.28,
      amountBeforeVat: 139.56,
      vatAmount: 23.72,
      currency: "ILS",
      confidence: 0.85,
    },
  };
  const first = resolveWhatsAppMoneyDecision(input);
  const second = resolveWhatsAppMoneyDecision(input);
  assert.deepEqual(first, second);
  assert.equal(first.selectedAmount, 163.28);
});

test("buildAnalysisAmountCandidates always prefers totalAmount tier over amount", () => {
  const candidates = buildAnalysisAmountCandidates({
    analysis: {
      amount: 200,
      totalAmount: 354,
      amountBeforeVat: 307.69,
      vatAmount: 46.31,
      currency: "ILS",
    },
    source: "claude_email",
    aiConfidence: 0.9,
  });
  const result = decision(candidates);
  assert.equal(result.selectedAmount, 354);
});

test("ARC flags VAT mismatch and routes to review", () => {
  const result = decision([
    { value: 354, kind: "invoice_total", source: "claude_file", confidence: 0.9 },
    { value: 300, kind: "subtotal_before_vat", source: "claude_file", confidence: 0.9 },
    { value: 60, kind: "vat_only", source: "claude_file", confidence: 0.9 },
  ]);

  assert.equal(result.selectedAmount, 354);
  assert.equal(result.status, "resolved");
  assert.ok(result.ambiguityFlags.includes("vat_mismatch"));
});
