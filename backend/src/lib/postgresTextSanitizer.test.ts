import test from "node:test";
import assert from "node:assert/strict";

import {
  sanitizePrismaWriteData,
  stripNulBytesDeep,
  stripNulBytesFromString,
} from "./postgresTextSanitizer.js";

const NUL = "\u0000";

test("stripNulBytesFromString removes embedded NUL bytes", () => {
  assert.equal(stripNulBytesFromString(`hello${NUL}world`), "helloworld");
  assert.equal(stripNulBytesFromString("clean"), "clean");
});

test("stripNulBytesDeep preserves numbers dates and null", () => {
  const date = new Date("2026-06-30T12:00:00.000Z");
  const input = {
    amount: 40.01,
    active: true,
    missing: null,
    occurredAt: date,
    tags: ["a", `b${NUL}c`],
  };
  const output = stripNulBytesDeep(input);
  assert.equal(output.amount, 40.01);
  assert.equal(output.active, true);
  assert.equal(output.missing, null);
  assert.equal(output.occurredAt, date);
  assert.deepEqual(output.tags, ["a", "bc"]);
});

test("stripNulBytesDeep cleans nested GmailScanItem rawAnalysis ocrText", () => {
  const payload = {
    decisionReason: "amount.vat_mismatch",
    parsedFieldsJson: {
      gates: [{ gate: "amount", verdict: "review", normalizedAmount: 40.01 }],
    },
    rawAnalysis: {
      ocrText: {
        pdfText: `Invoice total 40.01${NUL} USD`,
        visualAttachmentText: "",
      },
      supplier: "Anthropic PBC",
    },
  };
  const cleaned = stripNulBytesDeep(payload);
  assert.equal(cleaned.rawAnalysis.ocrText.pdfText, "Invoice total 40.01 USD");
  assert.deepEqual(cleaned.parsedFieldsJson, payload.parsedFieldsJson);
  assert.equal(cleaned.decisionReason, payload.decisionReason);
});

test("prod gate fixture stays identical when no NUL is present", () => {
  const prodGates = [
    {
      gate: "amount",
      verdict: "review",
      reasonCode: "amount.vat_mismatch",
      engineVersion: "amount-gate-v1",
      normalizedAmount: 40.01,
    },
    {
      gate: "supplier",
      verdict: "review",
      reasonCode: "supplier.sir_weak_evidence",
      engineVersion: "supplier-gate-v1",
      canonicalSupplierName: "Anthropic PBC #2619 9469 8575",
    },
    {
      gate: "fingerprint",
      tier: "invoice-amount",
      verdict: "pass",
      reasonCode: "fingerprint.resolved",
      engineVersion: "fingerprint-gate-v1",
      documentFingerprint: "20bbe52a32f65d5cd6189cc73761d1d9503aec6458363714",
    },
    {
      gate: "duplicate",
      verdict: "review",
      reasonCode: "duplicate.key_mismatch",
      engineVersion: "duplicate-gate-v1",
      matchStrength: "none",
      matchedReviewId: null,
      matchedPaymentId: null,
    },
  ];
  const fixture = { parsedFieldsJson: { gates: prodGates } };
  assert.deepEqual(stripNulBytesDeep(fixture), fixture);
});

test("sanitizePrismaWriteData cleans upsert create and update payloads", () => {
  const upsertPayload = {
    create: {
      subject: `Receipt${NUL}`,
      rawAnalysis: { ocrText: { pdfText: `PDF${NUL}TEXT` } },
    },
    update: {
      decisionReason: `process_save_failed${NUL}`,
    },
  };
  const cleaned = sanitizePrismaWriteData(upsertPayload);
  assert.equal(cleaned.create.subject, "Receipt");
  assert.equal(cleaned.create.rawAnalysis.ocrText.pdfText, "PDFTEXT");
  assert.equal(cleaned.update.decisionReason, "process_save_failed");
});

test("sanitizePrismaWriteData does not mutate where clauses when passed alone", () => {
  const where = { id: "cmr0a1p2o0tv5me2d9zdqsw3r" };
  assert.deepEqual(sanitizePrismaWriteData(where), where);
});
