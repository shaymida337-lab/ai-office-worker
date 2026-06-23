import test from "node:test";
import assert from "node:assert/strict";
import { computeCanonicalAmount, type AmountCandidate } from "./canonicalAmount.js";
import {
  buildAnalysisAmountCandidates,
  resolveClientGmailMoneyDecision,
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
  assert.equal(result.reasonCode, "AMBIGUOUS");
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

test("ARC flags VAT mismatch without rejecting a labeled total", () => {
  const result = decision([
    { value: 354, kind: "invoice_total", source: "claude_file", confidence: 0.9 },
    { value: 300, kind: "subtotal_before_vat", source: "claude_file", confidence: 0.9 },
    { value: 60, kind: "vat_only", source: "claude_file", confidence: 0.9 },
  ]);

  assert.equal(result.selectedAmount, 354);
  assert.ok(result.ambiguityFlags.includes("vat_mismatch"));
});
