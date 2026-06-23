import test from "node:test";
import assert from "node:assert/strict";
import { ARC_VERSION } from "../amount/canonicalAmount.js";
import type { MoneyDecision } from "../amount/canonicalAmount.js";
import { computeCanonicalFingerprint } from "../dedup/sharedMatcher.js";
import { SIR_VERSION } from "../supplier/supplierTypes.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";
import { computeFinancialSanity } from "../validation/financialSanity.js";
import type { FinancialSanityInput } from "../validation/sanityTypes.js";
import { FSE_VERSION } from "../validation/sanityTypes.js";
import { computeTrustDecision } from "../trust/trustEngine.js";
import type { TrustDecision } from "../trust/trustTypes.js";
import { TE_VERSION } from "../trust/trustTypes.js";
import { computeDocumentOutcome } from "./outcomeEngine.js";
import { buildOutcomeTimeline, resolveDocumentOutcomeStatus } from "./outcomeRules.js";
import type { OutcomeEngineInput } from "./outcomeTypes.js";
import { OE_VERSION } from "./outcomeTypes.js";

function supplierDecision(overrides: Partial<SupplierDecision> = {}): SupplierDecision {
  return {
    supplierName: "Acme Ltd",
    canonicalSupplier: "acme",
    normalizedName: "acme",
    vatNumber: "514888888",
    domains: ["acme.co.il"],
    emails: ["billing@acme.co.il"],
    phones: [],
    aliases: [],
    logo: null,
    confidence: 0.92,
    evidenceScore: 0.9,
    reason: "test",
    reasonCode: "AI_EXTRACTED",
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

function moneyDecision(overrides: Partial<MoneyDecision> = {}): MoneyDecision {
  return {
    selectedAmount: 1180,
    amountBeforeVat: 1000,
    vatAmount: 180,
    currency: "ILS",
    confidence: 0.9,
    evidenceScore: 0.88,
    reason: "test",
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

function strongFingerprint() {
  return computeCanonicalFingerprint({
    organizationId: "org-oe",
    supplierName: "Acme Ltd",
    supplierTaxId: "514888888",
    invoiceNumber: "INV-1001",
    totalAmount: 1180,
    documentDate: "2026-05-15",
    documentType: "tax_invoice",
  });
}

function fseInput(overrides: Partial<FinancialSanityInput> = {}): FinancialSanityInput {
  return {
    organizationId: "org-oe",
    supplierDecision: supplierDecision(),
    moneyDecision: moneyDecision(),
    fingerprint: strongFingerprint(),
    invoiceNumber: "INV-1001",
    documentDate: "2026-05-15",
    dueDate: null,
    currency: "ILS",
    invoiceData: {
      documentType: "tax_invoice",
      rawOcrText: "חשבונית מס Acme Ltd",
      extractionSource: "test",
    },
    context: {
      referenceDate: "2026-06-01",
      expectedCurrency: "ILS",
    },
    ...overrides,
  };
}

function trustDecision(overrides: Partial<TrustDecision> = {}): TrustDecision {
  return {
    version: TE_VERSION,
    confidence: 92,
    decision: "AUTO_SAVE",
    reason: "Sufficient trust for automatic action",
    reasonCode: "TE_AUTO_SAVE",
    explanation: "All checks passed with high confidence.",
    contributors: [],
    ...overrides,
  };
}

function outcomeInput(overrides: Partial<OutcomeEngineInput> = {}): OutcomeEngineInput {
  const fingerprint = strongFingerprint();
  const fseDecision = computeFinancialSanity(fseInput());
  const trust = computeTrustDecision({
    fingerprint,
    moneyDecision: moneyDecision(),
    supplierDecision: supplierDecision(),
    fseDecision,
  });

  return {
    trustDecision: trust,
    fseDecision,
    supplierDecision: supplierDecision(),
    moneyDecision: moneyDecision(),
    fingerprint,
    ...overrides,
  };
}

test("OE: returns oe-v1 outcome with required user-facing fields", () => {
  const outcome = computeDocumentOutcome(outcomeInput());

  assert.equal(outcome.version, OE_VERSION);
  assert.ok(outcome.headline.length > 0);
  assert.ok(outcome.description.length > 0);
  assert.ok(outcome.recommendedAction.length > 0);
  assert.equal(outcome.visibleToUser, true);
  assert.ok(outcome.timeline.length === 8);
});

test("OE: perfect save path", () => {
  const outcome = computeDocumentOutcome(outcomeInput());

  assert.equal(outcome.status, "SAVED");
  assert.equal(outcome.reasonCode, "OE_SAVED");
  assert.match(outcome.description, /Natalie trusted this document/i);
  assert.match(outcome.recommendedAction, /No action required/i);
});

test("OE: duplicate explains matched identity", () => {
  const match = "scfc-v1:org-oe:tax-invoice:514888888:inv1001";
  const outcome = computeDocumentOutcome(
    outcomeInput({
      context: {
        duplicateDetected: true,
        duplicateMatchIdentity: match,
      },
    })
  );

  assert.equal(outcome.status, "DUPLICATE");
  assert.equal(outcome.reasonCode, "OE_DUPLICATE_DETECTED");
  assert.match(outcome.description, new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("OE: review explains why", () => {
  const outcome = computeDocumentOutcome(
    outcomeInput({
      trustDecision: trustDecision({
        decision: "NEEDS_REVIEW",
        reasonCode: "TE_UPSTREAM_REVIEW",
        reason: "Upstream engine requested review",
        explanation: "ARC ambiguity requires manual review.",
      }),
      context: {
        reviewReason: "Supplier amount conflict needs approval",
      },
    })
  );

  assert.equal(outcome.status, "NEEDS_REVIEW");
  assert.match(outcome.description, /Supplier amount conflict needs approval/);
  assert.match(outcome.recommendedAction, /review queue/i);
});

test("OE: error explains failed stage", () => {
  const outcome = computeDocumentOutcome(
    outcomeInput({
      context: {
        pipelineError: "Claude timeout after 60s",
        processingStage: "AI Analysis",
      },
    })
  );

  assert.equal(outcome.status, "ERROR");
  assert.equal(outcome.reasonCode, "OE_PIPELINE_ERROR");
  assert.match(outcome.description, /AI Analysis/);
  assert.match(outcome.description, /Claude timeout/);
});

test("OE: blocked explains trust engine block", () => {
  const fseDecision = computeFinancialSanity(
    fseInput({
      documentDate: "2027-01-01",
    })
  );
  const trust = computeTrustDecision({
    fingerprint: strongFingerprint(),
    moneyDecision: moneyDecision(),
    supplierDecision: supplierDecision(),
    fseDecision,
  });

  const outcome = computeDocumentOutcome(
    outcomeInput({
      fseDecision,
      trustDecision: trust,
    })
  );

  assert.equal(trust.decision, "BLOCK");
  assert.equal(outcome.status, "BLOCKED");
  assert.equal(outcome.reasonCode, "OE_TRUST_BLOCKED");
  assert.match(outcome.description, /FSE/i);
});

test("OE: not financial outcome", () => {
  const outcome = computeDocumentOutcome(
    outcomeInput({
      context: {
        processingStage: "not_financial",
        reviewReason: "filtered_irrelevant newsletter",
      },
      moneyDecision: moneyDecision({ status: "missing", selectedAmount: null }),
      supplierDecision: supplierDecision({ status: "missing", supplierName: null }),
      fseDecision: computeFinancialSanity(fseInput()),
      trustDecision: trustDecision({ decision: "NEEDS_REVIEW" }),
    })
  );

  assert.equal(outcome.status, "NOT_FINANCIAL");
  assert.equal(outcome.reasonCode, "OE_NOT_FINANCIAL");
});

test("OE: timeline contains full engine chain", () => {
  const outcome = computeDocumentOutcome(outcomeInput());
  const names = outcome.timeline.map((step) => step.name);

  assert.deepEqual(names, [
    "Received",
    "AI Analysis",
    "SCFC",
    "ARC",
    "SIR",
    "FSE",
    "Trust Engine",
    "Final Decision",
  ]);
  assert.ok(outcome.timeline.every((step) => step.engine && step.explanation));
});

test("OE: exactly one final status", () => {
  const cases: OutcomeEngineInput[] = [
    outcomeInput(),
    outcomeInput({ context: { duplicateDetected: true, duplicateMatchIdentity: "dup-1" } }),
    outcomeInput({
      trustDecision: trustDecision({ decision: "NEEDS_REVIEW", reasonCode: "TE_UPSTREAM_REVIEW" }),
    }),
    outcomeInput({ context: { pipelineError: "db timeout", processingStage: "FSE" } }),
    outcomeInput({
      context: { processingStage: "not_financial" },
      trustDecision: trustDecision({ decision: "NEEDS_REVIEW" }),
    }),
  ];

  for (const input of cases) {
    const outcome = computeDocumentOutcome(input);
    const statuses = new Set([outcome.status]);
    assert.equal(statuses.size, 1);
  }
});

test("OE: deterministic output", () => {
  const input = outcomeInput({
    context: { duplicateDetected: true, duplicateMatchIdentity: "dup-stable" },
  });
  assert.deepEqual(computeDocumentOutcome(input), computeDocumentOutcome(input));
});

test("OE: resolveDocumentOutcomeStatus priority error over duplicate", () => {
  const resolution = resolveDocumentOutcomeStatus(
    outcomeInput({
      context: {
        pipelineError: "fatal",
        duplicateDetected: true,
      },
    })
  );

  assert.equal(resolution.status, "ERROR");
});

test("OE: buildOutcomeTimeline marks failed stage on error", () => {
  const resolution = resolveDocumentOutcomeStatus(
    outcomeInput({
      context: {
        pipelineError: "vision OCR failed",
        processingStage: "AI Analysis",
      },
    })
  );
  const timeline = buildOutcomeTimeline(
    outcomeInput({
      context: {
        pipelineError: "vision OCR failed",
        processingStage: "AI Analysis",
      },
    }),
    resolution
  );

  const aiStep = timeline.find((step) => step.name === "AI Analysis");
  assert.equal(aiStep?.status, "failed");
});
