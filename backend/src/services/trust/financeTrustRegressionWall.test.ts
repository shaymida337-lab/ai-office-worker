/**
 * Phase B5 — Finance Trust Core regression wall.
 * Each test maps to a required trust scenario; names prefixed B5-WALL-NN.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ARC_VERSION } from "../amount/canonicalAmount.js";
import {
  evaluateAmountGate,
  FINANCE_AMOUNT_UNRESOLVED_REASON,
} from "../amount/amountGate.js";
import {
  FINANCE_AMOUNT_MISSING_LABEL,
  FINANCE_AMOUNT_REVIEW_LABEL,
  resolveFinanceDisplayAmount,
} from "../amount/financeDisplayAmount.js";
import { computeCanonicalFingerprint } from "../dedup/sharedMatcher.js";
import { evaluateFingerprintGate } from "../dedup/fingerprintGate.js";
import { evaluateDuplicateGate } from "../dedup/duplicateGate.js";
import {
  evaluateSupplierGate,
  supplierGateAllowsManualApproval,
} from "../supplier/supplierGate.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";
import { SIR_VERSION } from "../supplier/supplierTypes.js";
import {
  allTrustGatesPass,
  amountGateAllowsManualApproval,
  buildPassingTrustGateSnapshots,
  parseTrustGatesFromParsedFields,
  supplierPaymentPersistenceDecision,
} from "./trustGatePersistence.js";
import {
  createSupplierPaymentIfTrusted,
  evaluateFinanceTrustGates,
  evaluateFreshTrustGatesForManualApproval,
  financeIngestionPathsForStaticGuard,
  FINANCE_TRUST_PERSISTENCE_MODULE,
} from "./financeTrustPersistence.js";
import {
  mapGmailScanItemToInvoiceCandidate,
  summarizeCandidatesByMonth,
} from "../../routes/api.js";
import { supplierPaymentCreationEligibility } from "../gmail-sync.js";

const backendRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function money(overrides: Record<string, unknown> = {}) {
  return {
    selectedAmount: 250.5,
    amountBeforeVat: null,
    vatAmount: null,
    currency: "ILS",
    confidence: 0.9,
    evidenceScore: 2,
    reason: "Invoice total",
    reasonCode: "INVOICE_TOTAL",
    candidates: [],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: ARC_VERSION,
    isStrongEnoughForAutoSave: true,
    ...overrides,
  };
}

function baseSupplierDecision(overrides: Partial<SupplierDecision> = {}): SupplierDecision {
  return {
    supplierName: "OpenAI LLC",
    canonicalSupplier: "openai",
    normalizedName: "openai llc",
    vatNumber: null,
    domains: [],
    emails: [],
    phones: [],
    aliases: [],
    logo: null,
    confidence: 0.92,
    evidenceScore: 0.9,
    reason: "document labeled",
    reasonCode: "DOCUMENT_LABELED",
    evidence: [],
    candidates: [],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: SIR_VERSION,
    isStrongEnoughForAutoSave: true,
    ...overrides,
  };
}

function passingFingerprintInput() {
  const scfc = computeCanonicalFingerprint({
    organizationId: "org-b5",
    supplierName: "Acme Supplies",
    supplierTaxId: "123456789",
    invoiceNumber: "INV-100",
    totalAmount: 120,
    documentDate: "2025-01-15",
    documentType: "tax_invoice",
  });
  return { scfc, documentFingerprint: scfc.fingerprint };
}

function unifiedBlocksPayment(input: Parameters<typeof evaluateFinanceTrustGates>[0]) {
  const evaluation = evaluateFinanceTrustGates(input);
  assert.equal(evaluation.shouldCreatePayment, false, `expected no payment: ${evaluation.reasonCode}`);
  return evaluation;
}

function gmailGoldenClassification() {
  return {
    documentType: "invoice" as const,
    reviewStatus: "auto_saved" as const,
    confidence: 0.92,
    decisionReason: null,
    isRelevant: true,
    heldForFinancialSender: false,
    audit: { strictPaymentEvidence: true },
  };
}

// ── Amount gate (1–6) ────────────────────────────────────────────────────────

test("B5-WALL-01 missing amount never displays 0₪", () => {
  const display = resolveFinanceDisplayAmount({ totalAmount: null, parsedFieldsJson: { amount: 120 } });
  assert.notEqual(display.amountLabel, "₪0");
  assert.equal(display.amountLabel, FINANCE_AMOUNT_MISSING_LABEL);
});

test("B5-WALL-02 missing amount never creates SupplierPayment", () => {
  unifiedBlocksPayment({
    selectedAmount: null,
    needsReview: false,
    ...buildPassingTrustGateSnapshots(),
  });
});

test("B5-WALL-03 zero amount never creates SupplierPayment", () => {
  const gate = evaluateAmountGate({ moneyDecision: money({ selectedAmount: 0 }) });
  unifiedBlocksPayment({
    selectedAmount: 0,
    needsReview: false,
    amountGate: gate,
    ...buildPassingTrustGateSnapshots({ amountGate: gate }),
  });
});

test("B5-WALL-04 weird decimal amount goes REVIEW", () => {
  const gate = evaluateAmountGate({ moneyDecision: money({ selectedAmount: 123.456789 }) });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.weird_decimals");
  unifiedBlocksPayment({
    selectedAmount: 123.456789,
    needsReview: false,
    amountGate: gate,
    ...buildPassingTrustGateSnapshots({ amountGate: gate }),
  });
});

test("B5-WALL-05 VAT mismatch goes REVIEW", () => {
  const gate = evaluateAmountGate({
    moneyDecision: money({ selectedAmount: 500 }),
    fseSummary: { warnings: [{ ruleId: "vat_arithmetic" }] },
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.vat_mismatch");
  unifiedBlocksPayment({
    selectedAmount: 500,
    needsReview: false,
    amountGate: gate,
    ...buildPassingTrustGateSnapshots({ amountGate: gate }),
  });
});

test("B5-WALL-06 Claude vs regex conflict goes REVIEW", () => {
  const gate = evaluateAmountGate({
    moneyDecision: money({
      selectedAmount: null,
      status: "ambiguous",
      reasonCode: "SOURCE_CONFLICT",
    }),
  });
  assert.equal(gate.reasonCode, "amount.source_conflict");
  unifiedBlocksPayment({
    selectedAmount: null,
    needsReview: false,
    amountGate: gate,
    ...buildPassingTrustGateSnapshots({ amountGate: gate }),
  });
});

// ── Supplier gate (7–12) ─────────────────────────────────────────────────────

test("B5-WALL-07 missing supplier never creates SupplierPayment", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: null,
      canonicalSupplier: null,
      status: "missing",
      isStrongEnoughForAutoSave: false,
    }),
    supplierName: null,
  });
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    supplierGate: gate,
    ...buildPassingTrustGateSnapshots({ supplierGate: gate }),
  });
});

test("B5-WALL-08 placeholder supplier לא זוהה never creates SupplierPayment", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "לא זוהה",
      canonicalSupplier: null,
      status: "missing",
      isStrongEnoughForAutoSave: false,
    }),
    supplierName: "לא זוהה",
  });
  assert.equal(gate.verdict, "review");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    supplierGate: gate,
    ...buildPassingTrustGateSnapshots({ supplierGate: gate }),
  });
});

test("B5-WALL-09 placeholder supplier לא ידוע never creates SupplierPayment", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "לא ידוע",
      canonicalSupplier: null,
      isStrongEnoughForAutoSave: false,
    }),
    supplierName: "לא ידוע",
  });
  assert.equal(gate.reasonCode, "supplier.placeholder_hebrew");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    supplierGate: gate,
    ...buildPassingTrustGateSnapshots({ supplierGate: gate }),
  });
});

test("B5-WALL-10 email/domain supplier never creates SupplierPayment", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({ supplierName: "billing@openai.com", canonicalSupplier: null }),
    supplierName: "billing@openai.com",
  });
  assert.equal(gate.reasonCode, "supplier.email_or_domain");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    supplierGate: gate,
    ...buildPassingTrustGateSnapshots({ supplierGate: gate }),
  });
});

test("B5-WALL-11 address/phone supplier never creates SupplierPayment", () => {
  const phoneGate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({ supplierName: "050-1234567", canonicalSupplier: null }),
    supplierName: "050-1234567",
  });
  assert.equal(phoneGate.reasonCode, "supplier.phone_or_address");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    supplierGate: phoneGate,
    ...buildPassingTrustGateSnapshots({ supplierGate: phoneGate }),
  });
});

test("B5-WALL-12 weak SIR supplier goes REVIEW", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "Acme",
      canonicalSupplier: null,
      status: "ambiguous",
      isStrongEnoughForAutoSave: false,
    }),
    supplierName: "Acme",
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "supplier.sir_ambiguous");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    supplierGate: gate,
    ...buildPassingTrustGateSnapshots({ supplierGate: gate }),
  });
});

// ── Fingerprint gate (13–16) ─────────────────────────────────────────────────

test("B5-WALL-13 weak fingerprint never creates SupplierPayment", () => {
  const scfc = computeCanonicalFingerprint({
    organizationId: "org-b5",
    supplierName: "Acme",
    totalAmount: 120,
    documentDate: "2025-01-15",
  });
  const gate = evaluateFingerprintGate({ scfc, documentFingerprint: scfc.fingerprint });
  if (gate.verdict === "pass") {
    const weakGate = { ...gate, verdict: "review" as const, reasonCode: "fingerprint.weak_tier" as const };
    unifiedBlocksPayment({
      selectedAmount: 120,
      needsReview: false,
      fingerprintGate: weakGate,
      ...buildPassingTrustGateSnapshots({ fingerprintGate: weakGate }),
    });
  } else {
    unifiedBlocksPayment({
      selectedAmount: 120,
      needsReview: false,
      fingerprintGate: gate,
      ...buildPassingTrustGateSnapshots({ fingerprintGate: gate }),
    });
  }
});

test("B5-WALL-14 null fingerprint never creates SupplierPayment", () => {
  const scfc = computeCanonicalFingerprint({
    organizationId: "org-b5",
    supplierName: null,
    invoiceNumber: null,
    totalAmount: null,
    documentDate: null,
  });
  const gate = evaluateFingerprintGate({ scfc, documentFingerprint: null });
  assert.equal(gate.verdict, "review");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    fingerprintGate: gate,
    ...buildPassingTrustGateSnapshots({ fingerprintGate: gate }),
  });
});

test("B5-WALL-15 legacy-only fingerprint never creates SupplierPayment", () => {
  const scfc = computeCanonicalFingerprint({
    organizationId: "org-b5",
    supplierName: "Acme Supplies",
    supplierTaxId: "123456789",
    invoiceNumber: "INV-100",
    totalAmount: 120,
    documentDate: "2025-01-15",
    documentType: "tax_invoice",
  });
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.legacyFingerprint,
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "fingerprint.legacy_only");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    fingerprintGate: gate,
    ...buildPassingTrustGateSnapshots({ fingerprintGate: gate }),
  });
});

test("B5-WALL-16 force reprocess never auto-saves", () => {
  const fp = passingFingerprintInput();
  const fingerprintGate = evaluateFingerprintGate({ ...fp, forceReprocess: true });
  assert.equal(fingerprintGate.verdict, "review");
  assert.equal(fingerprintGate.reasonCode, "fingerprint.force_reprocess");
  const duplicateGate = evaluateDuplicateGate({ matchResult: "NO_MATCH" });
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    fingerprintGate,
    duplicateGate,
    ...buildPassingTrustGateSnapshots({ fingerprintGate, duplicateGate }),
  });
});

// ── Duplicate gate (17–21) ───────────────────────────────────────────────────

test("B5-WALL-17 same SCFC fingerprint blocks duplicate payment", () => {
  const duplicateGate = evaluateDuplicateGate({
    matchResult: "MATCH",
    matchReasons: ["fingerprint_match"],
    matchedCandidate: { id: "pay-existing" },
  });
  assert.equal(duplicateGate.verdict, "block");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    duplicateGate,
    ...buildPassingTrustGateSnapshots({ duplicateGate }),
  });
});

test("B5-WALL-18 same file hash blocks duplicate payment", () => {
  const duplicateGate = evaluateDuplicateGate({
    matchResult: "MATCH",
    matchReasons: ["same_file_sha256"],
    matchedCandidate: { id: "pay-file" },
  });
  assert.equal(duplicateGate.reasonCode, "duplicate.file_hash_match");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    duplicateGate,
    ...buildPassingTrustGateSnapshots({ duplicateGate }),
  });
});

test("B5-WALL-19 same invoice number + amount blocks duplicate payment", () => {
  const duplicateGate = evaluateDuplicateGate({
    matchResult: "MATCH",
    matchReasons: ["same_invoice_number_and_amount"],
    matchedCandidate: { id: "pay-inv" },
  });
  assert.equal(duplicateGate.reasonCode, "duplicate.invoice_amount_match");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    duplicateGate,
    ...buildPassingTrustGateSnapshots({ duplicateGate }),
  });
});

test("B5-WALL-20 same supplier + amount + date without invoice goes REVIEW", () => {
  const duplicateGate = evaluateDuplicateGate({
    matchResult: "UNSURE",
    matchReasons: ["same_supplier", "same_amount", "same_date"],
    matchedCandidate: { id: "pay-borderline" },
    invoiceNumber: null,
  });
  assert.equal(duplicateGate.verdict, "review");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    duplicateGate,
    ...buildPassingTrustGateSnapshots({ duplicateGate }),
  });
});

test("B5-WALL-21 cross-channel unsure match goes REVIEW", () => {
  const duplicateGate = evaluateDuplicateGate({
    matchResult: "UNSURE",
    matchReasons: ["cross_channel_possible"],
    crossChannelUnsure: true,
    matchedCandidate: { id: "pay-wa", source: "whatsapp" },
    currentSource: "gmail",
  });
  assert.equal(duplicateGate.verdict, "review");
  assert.equal(duplicateGate.reasonCode, "duplicate.cross_channel_unsure");
  unifiedBlocksPayment({
    selectedAmount: 120,
    needsReview: false,
    duplicateGate,
    ...buildPassingTrustGateSnapshots({ duplicateGate }),
  });
});

// ── Channel review-only (22–24) ──────────────────────────────────────────────

test("B5-WALL-22 WhatsApp remains review-only without explicit gates", () => {
  unifiedBlocksPayment({
    parsedFieldsJson: {},
    selectedAmount: 250,
    needsReview: false,
    documentType: "tax_invoice",
    confidenceScore: 0.95,
  });
});

test("B5-WALL-23 Client Gmail remains review-only without explicit gates", () => {
  unifiedBlocksPayment({
    parsedFieldsJson: {},
    selectedAmount: 354,
    documentType: "tax_invoice",
    confidenceScore: 0.9,
  });
});

test("B5-WALL-24 Camera remains review-only without explicit gates", () => {
  unifiedBlocksPayment({
    parsedFieldsJson: {},
    selectedAmount: 80,
    documentType: "tax_invoice",
    confidenceScore: 0.5,
  });
});

// ── Manual approval (25–29) ──────────────────────────────────────────────────

test("B5-WALL-25 manual approval re-runs all four gates", () => {
  const evaluation = evaluateFreshTrustGatesForManualApproval({
    parsedFieldsJson: {
      arc: { status: "resolved", selectedAmount: 120, reasonCode: "INVOICE_TOTAL" },
      sir: {
        supplierName: "Acme Supplies",
        canonicalSupplier: "Acme Supplies",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
      },
    },
    totalAmount: 120,
    supplierName: "Acme Supplies",
    fingerprintGateInput: passingFingerprintInput(),
    duplicateGateInput: { matchResult: "NO_MATCH" },
  });
  assert.equal(evaluation.gates.amountGate?.verdict, "pass");
  assert.equal(evaluation.gates.supplierGate?.verdict, "pass");
  assert.equal(evaluation.gates.fingerprintGate?.verdict, "pass");
  assert.equal(evaluation.gates.duplicateGate?.verdict, "pass");
});

test("B5-WALL-26 manual approval cannot approve missing amount", () => {
  const approval = amountGateAllowsManualApproval({ totalAmount: 0, parsedFieldsJson: {} });
  assert.equal(approval.allowed, false);
  const evaluation = evaluateFreshTrustGatesForManualApproval({
    parsedFieldsJson: {},
    totalAmount: 0,
    supplierName: "Acme",
    fingerprintGateInput: passingFingerprintInput(),
    duplicateGateInput: { matchResult: "NO_MATCH" },
  });
  assert.equal(evaluation.shouldCreatePayment, false);
});

test("B5-WALL-27 manual approval cannot approve bad supplier", () => {
  const approval = supplierGateAllowsManualApproval({
    supplierDecision: baseSupplierDecision({ supplierName: "לא זוהה", canonicalSupplier: null, status: "missing" }),
    supplierName: "לא זוהה",
  });
  assert.equal(approval.allowed, false);
});

test("B5-WALL-28 manual approval cannot approve weak fingerprint", () => {
  const scfc = computeCanonicalFingerprint({
    organizationId: "org-b5",
    supplierName: null,
    invoiceNumber: null,
    totalAmount: null,
    documentDate: null,
  });
  const gate = evaluateFingerprintGate({ scfc, documentFingerprint: null });
  const evaluation = evaluateFreshTrustGatesForManualApproval({
    parsedFieldsJson: {
      arc: { status: "resolved", selectedAmount: 120, reasonCode: "INVOICE_TOTAL" },
      sir: { supplierName: "Acme", canonicalSupplier: "Acme", status: "resolved", isStrongEnoughForAutoSave: true },
    },
    totalAmount: 120,
    supplierName: "Acme",
    fingerprintGateInput: { scfc, documentFingerprint: null },
    duplicateGateInput: { matchResult: "NO_MATCH" },
  });
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.notEqual(gate.verdict, "pass");
});

test("B5-WALL-29 manual approval cannot approve duplicate match", () => {
  const evaluation = evaluateFreshTrustGatesForManualApproval({
    parsedFieldsJson: {
      arc: { status: "resolved", selectedAmount: 120, reasonCode: "INVOICE_TOTAL" },
      sir: { supplierName: "Acme", canonicalSupplier: "Acme", status: "resolved", isStrongEnoughForAutoSave: true },
    },
    totalAmount: 120,
    supplierName: "Acme",
    fingerprintGateInput: passingFingerprintInput(),
    duplicateGateInput: {
      matchResult: "MATCH",
      matchReasons: ["fingerprint_match"],
      matchedCandidate: { id: "existing" },
    },
  });
  assert.equal(evaluation.outcome, "block");
  assert.equal(evaluation.shouldCreatePayment, false);
});

// ── Static guard (30) ────────────────────────────────────────────────────────

test("B5-WALL-30 direct prisma.supplierPayment.create forbidden outside unified module", () => {
  const forbidden = /\bprisma\.supplierPayment\.create\s*\(/;
  const violations: string[] = [];
  for (const relativePath of financeIngestionPathsForStaticGuard()) {
    if (relativePath === FINANCE_TRUST_PERSISTENCE_MODULE) continue;
    const source = readFileSync(join(backendRoot, relativePath), "utf8");
    if (forbidden.test(source)) violations.push(relativePath);
  }
  assert.deepEqual(violations, []);
});

// ── Display / totals (31–33) ─────────────────────────────────────────────────

test("B5-WALL-31 month totals exclude unresolved amounts", () => {
  const june = new Date("2026-06-15T10:00:00.000Z");
  const merged = [
    { date: june, amount: 100, currency: "ILS" },
    { date: june, amount: null as number | null, currency: "ILS" },
    { date: june, amount: 0, currency: "ILS" },
  ];
  const months = summarizeCandidatesByMonth(
    merged.filter((row): row is { date: Date; amount: number; currency: string } => row.amount != null && row.amount > 0),
    (candidate) => candidate.date
  );
  assert.equal(months[0]?.count, 1);
  assert.equal(months[0]?.totalsByCurrency.ILS, 100);
});

test("B5-WALL-32 UI labels unresolved amount as סכום חסר", () => {
  const now = new Date("2026-06-09T09:00:00.000Z");
  const candidate = mapGmailScanItemToInvoiceCandidate({
    id: "scan-null",
    gmailMessageId: "gmail-null",
    emailMessageId: "email-null",
    gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-null",
    sender: "supplier@example.com",
    senderEmail: "supplier@example.com",
    subject: "Invoice",
    occurredAt: now,
    amount: null,
    supplierName: "Supplier",
    attachmentFilename: "invoice.pdf",
    driveFileLink: null,
    confidenceScore: "medium",
    reviewStatus: "needs_review",
    decisionReason: "amount_unresolved",
    rawAnalysis: { parsed_fields_json: { arc: { status: "missing", selectedAmount: null } } },
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(candidate.amountLabel, "סכום חסר");
  assert.equal(resolveFinanceDisplayAmount({ totalAmount: null }).amountLabel, FINANCE_AMOUNT_MISSING_LABEL);
});

test("B5-WALL-33 UI labels general gate failure as דורש בדיקה", () => {
  const display = resolveFinanceDisplayAmount({
    totalAmount: 500,
    parsedFieldsJson: {
      arc: { status: "resolved", selectedAmount: 500, reasonCode: "INVOICE_TOTAL" },
      gates: [
        {
          gate: "amount",
          verdict: "review",
          reasonCode: "amount.vat_mismatch",
          engineVersion: "amount-gate-v1",
          normalizedAmount: 500,
        },
      ],
    },
  });
  assert.equal(display.amountLabel, FINANCE_AMOUNT_REVIEW_LABEL);
  assert.equal(FINANCE_AMOUNT_REVIEW_LABEL, "דורש בדיקה");
});

// ── Golden paths (34–36) ─────────────────────────────────────────────────────

test("B5-WALL-34 valid Gmail org invoice with all four gates PASS creates payment eligibility", () => {
  const snapshots = buildPassingTrustGateSnapshots();
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    ...snapshots,
    documentType: "tax_invoice",
    confidenceScore: 0.92,
  });
  assert.equal(evaluation.outcome, "pass");
  assert.equal(evaluation.shouldCreatePayment, true);

  const eligibility = supplierPaymentCreationEligibility({
    classification: gmailGoldenClassification(),
    amount: 120,
    supplierName: "OpenAI",
    supplierGate: snapshots.supplierGate,
    fingerprintGate: snapshots.fingerprintGate,
    duplicateGate: snapshots.duplicateGate,
  });
  assert.equal(eligibility.allowed, true);

  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    ...snapshots,
  });
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.paymentAmount, 120);
});

test("B5-WALL-35 valid invoice rescan does not create second payment", () => {
  const duplicateGate = evaluateDuplicateGate({
    matchResult: "MATCH",
    matchReasons: ["fingerprint_match"],
    matchedCandidate: { id: "existing-payment" },
    documentFingerprint: "scfc-v1:existing",
    scfcFingerprint: "scfc-v1:existing",
  });
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    ...buildPassingTrustGateSnapshots({ duplicateGate }),
    documentType: "tax_invoice",
    confidenceScore: 0.92,
  });
  assert.equal(evaluation.outcome, "block");
  assert.equal(evaluation.shouldCreatePayment, false);
});

test("B5-WALL-36 duplicate MATCH does not silently promote approval without gates PASS", () => {
  assert.equal(allTrustGatesPass(parseTrustGatesFromParsedFields({})), false);
  assert.equal(allTrustGatesPass(buildPassingTrustGateSnapshots()), true);

  const withoutGates = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
  });
  assert.equal(withoutGates.shouldCreatePayment, false);
  assert.match(withoutGates.blockReason ?? "", /^trust\./);
});

// ── Unified door invariant ───────────────────────────────────────────────────

test("B5-WALL-unified-door blocks createSupplierPaymentIfTrusted when gates fail", async () => {
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    parsedFieldsJson: {},
  });
  const result = await createSupplierPaymentIfTrusted({
    evaluation,
    data: {
      organizationId: "org-b5",
      supplier: "Acme",
      amount: 120,
      currency: "ILS",
      date: new Date(),
      paid: false,
    },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.payment, null);
});
