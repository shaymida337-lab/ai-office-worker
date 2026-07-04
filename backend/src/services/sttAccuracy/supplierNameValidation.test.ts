import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  assessSupplierNameForStt,
  filterSupplierNamesForStt,
  getSupplierNameHygieneSnapshot,
  isValidSupplierNameForStt,
  recordSupplierNameHygieneScan,
  resetSupplierNameHygieneMetrics,
} from "./supplierNameValidation.js";
import { processTranscriptAccuracy } from "./sttNormalizer.js";
import { correctBusinessNamesInTranscript, safeCorrectSupplierNamesInTranscript } from "./sttNameCorrection.js";
import type { SttVocabulary } from "./sttAccuracyTypes.js";

const baseVocabulary: SttVocabulary = {
  organizationId: "org-1",
  organizationName: "משרד לדוגמה",
  clientNames: ["דני כהן"],
  supplierNames: ["חברת החשמל", "בזק"],
  serviceNames: ["ייעוץ"],
  memberNames: [],
  businessTerms: ["חשבונית", "תשלום"],
};

describe("supplier name validation", () => {
  beforeEach(() => {
    resetSupplierNameHygieneMetrics();
  });

  const rejectedCases = [
    ["normalizeDetectedAmount(result.totalAmount", "code_fragment"],
    ["supplier(", "abnormal_punctuation"],
    ["supplier[", "abnormal_punctuation"],
    ["supplier*", "abnormal_punctuation"],
    ["supplier+", "abnormal_punctuation"],
    ["supplier?", "abnormal_punctuation"],
    ["supplier|", "abnormal_punctuation"],
    ["(()())", "code_fragment"],
    ["x".repeat(120), "too_long"],
  ] as const;

  for (const [name, reason] of rejectedCases) {
    it(`rejects malformed supplier name: ${name.slice(0, 24)}`, () => {
      const result = assessSupplierNameForStt(name);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, reason);
      }
      assert.equal(isValidSupplierNameForStt(name), false);
    });
  }

  it("accepts mixed Hebrew/English supplier names with normal punctuation", () => {
    for (const name of ["Anthropic, PBC", "עיריית רamat-gan", "חברת החשמל Ltd."]) {
      assert.equal(isValidSupplierNameForStt(name), true, name);
    }
  });

  it("filters malformed names out of STT vocabulary without deleting source data semantics", () => {
    const filtered = filterSupplierNamesForStt([
      "בזק",
      "normalizeDetectedAmount(result.totalAmount",
      "supplier*",
      "Anthropic, PBC",
    ]);
    assert.deepEqual(filtered.accepted, ["בזק", "Anthropic, PBC"]);
    assert.equal(filtered.ignoredCount, 2);
    assert.ok((filtered.ignoredByReason.code_fragment ?? 0) >= 1);
  });

  it("records aggregate hygiene counts without logging supplier values", () => {
    recordSupplierNameHygieneScan({
      candidateCount: 4,
      ignoredCount: 2,
      ignoredByReason: { code_fragment: 1, abnormal_punctuation: 1 },
    });
    const snapshot = getSupplierNameHygieneSnapshot();
    assert.equal(snapshot.totalCandidates, 4);
    assert.equal(snapshot.ignoredTotal, 2);
    assert.equal(snapshot.vocabularyBuilds, 1);
  });
});

describe("natalie voice reliability lock", () => {
  const maliciousSuppliers = [
    "normalizeDetectedAmount(result.totalAmount",
    "supplier(",
    "supplier[",
    "supplier*",
    "supplier+",
    "supplier?",
    "supplier|",
    "(()())",
    "x".repeat(120),
  ];

  for (const malicious of maliciousSuppliers) {
    it(`never throws when supplier vocabulary includes ${malicious.slice(0, 20)}`, async () => {
      const vocabulary: SttVocabulary = {
        ...baseVocabulary,
        supplierNames: [...baseVocabulary.supplierNames, malicious],
      };

      assert.doesNotThrow(() => correctBusinessNamesInTranscript("כמה שילמתי החודש", vocabulary));
      assert.doesNotThrow(() =>
        safeCorrectSupplierNamesInTranscript("כמה שילמתי החודש", vocabulary, {
          organizationId: "org-1",
          requestId: "req-test",
        })
      );

      const result = await processTranscriptAccuracy({
        organizationId: "org-1",
        rawTranscript: "כמה שילמתי החודש",
        vocabulary,
        skipClarification: true,
        requestId: "req-test",
      });
      assert.match(result.normalizedTranscript, /כמה שילמתי החודש/);
    });
  }

  it("continues with original transcript when supplier normalization is forced to fail", async () => {
    const vocabulary: SttVocabulary = {
      ...baseVocabulary,
      supplierNames: ["בזק"],
    };
    const originalTest = RegExp.prototype.test;
    RegExp.prototype.test = function forcedFailure() {
      throw new SyntaxError("forced supplier normalization failure");
    };

    try {
      const result = safeCorrectSupplierNamesInTranscript("חשבונית מבזק", vocabulary, {
        organizationId: "org-1",
        requestId: "req-fallback",
      });
      assert.match(result.text, /חשבונית מבזק/);
      assert.equal(result.corrections.length, 0);

      const accuracy = await processTranscriptAccuracy({
        organizationId: "org-1",
        rawTranscript: "חשבונית מבזק",
        vocabulary,
        skipClarification: true,
        requestId: "req-fallback",
      });
      assert.match(accuracy.normalizedTranscript, /חשבונית|בזק/);
    } finally {
      RegExp.prototype.test = originalTest;
    }
  });
});
