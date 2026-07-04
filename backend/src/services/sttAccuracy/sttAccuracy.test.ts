import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { detectRiskyActions, buildActionSafetyClarification } from "./sttActionSafety.js";
import { assessTranscriptConfidence, buildLowConfidenceClarification } from "./sttConfidence.js";
import { normalizeHebrewNumbersInTranscript } from "./sttHebrewNumbers.js";
import {
  buildNameClarificationQuestion,
  correctBusinessNamesInTranscript,
} from "./sttNameCorrection.js";
import { getSttAccuracyMetricSnapshots, recordSttAccuracyMetric, resetSttAccuracyMetrics } from "./sttMetrics.js";
import { processTranscriptAccuracy } from "./sttNormalizer.js";
import type { SttVocabulary } from "./sttAccuracyTypes.js";

const vocabulary: SttVocabulary = {
  organizationId: "org-1",
  organizationName: "משרד לדוגמה",
  clientNames: ["דני כהן", "מיכל לוי", "רונית אברהם"],
  supplierNames: ["חברת החשמל", "בזק", "Wolt", "Pango", "סלקום"],
  serviceNames: ["ייעוץ", "טיפול"],
  memberNames: ["שי מזרחי"],
  businessTerms: ["חשבונית", "תשלום", "תור"],
};

describe("natalie stt accuracy", () => {
  beforeEach(() => {
    resetSttAccuracyMetrics();
  });

  it("normalizes spoken Hebrew amounts", () => {
    const result = normalizeHebrewNumbersInTranscript("מאה עשרים וחמש שקל");
    assert.match(result.text, /125/);
    assert.match(result.text, /₪|שקל/);
    assert.equal(result.corrections.length, 1);
  });

  it("normalizes thousands", () => {
    const result = normalizeHebrewNumbersInTranscript("יש לי חוב של אלף מאתיים שקל");
    assert.match(result.text, /1,200/);
  });

  it("normalizes day-of-month phrases", () => {
    const result = normalizeHebrewNumbersInTranscript("התשלום ב שלושים ואחד לחודש");
    assert.match(result.text, /31 לחודש/);
  });

  it("normalizes spoken phone digits", () => {
    const result = normalizeHebrewNumbersInTranscript("הטלפון שלו אפס חמש שתיים");
    assert.match(result.text, /052/);
  });

  it("corrects likely supplier aliases with high confidence", () => {
    const result = correctBusinessNamesInTranscript("תראי חשבונית מחשמל ישראל", vocabulary);
    assert.match(result.text, /חברת החשמל/);
    assert.ok(result.corrections.some((correction) => correction.kind === "supplier_name"));
  });

  it("corrects client names from known vocabulary", () => {
    const result = correctBusinessNamesInTranscript("תקבעי תור לדני כהן", vocabulary);
    assert.match(result.text, /דני כהן/);
  });

  it("asks clarification for ambiguous supplier suggestions", () => {
    const question = buildNameClarificationQuestion(["בזק", "סלקום"]);
    assert.match(question ?? "", /בזק/);
    assert.match(question ?? "", /סלקום/);
  });

  it("detects risky business actions in transcript", () => {
    const actions = detectRiskyActions("אשרי תשלום לספק בזק");
    assert.ok(actions.includes("approve_payment"));
  });

  it("builds action safety clarification when confidence is not high", () => {
    const message = buildActionSafetyClarification(["approve_payment"]);
    assert.match(message ?? "", /לא בטוחה/);
  });

  it("assesses low confidence for very short unclear transcripts", () => {
    const result = assessTranscriptConfidence({
      rawTranscript: "כן",
      normalizedTranscript: "כן",
      corrections: [],
      ambiguousNameCount: 0,
      detectedActions: [],
    });
    assert.equal(result.level, "low");
  });

  it("builds low confidence clarification for normalized amounts", () => {
    const message = buildLowConfidenceClarification({
      confidence: 0.5,
      normalizedTranscript: "125 ₪",
      corrections: [
        {
          kind: "hebrew_number",
          original: "מאה עשרים וחמש שקל",
          corrected: "125 ₪",
          confidence: 0.9,
          ambiguous: false,
        },
      ],
    });
    assert.match(message ?? "", /125/);
    assert.match(message ?? "", /לא בטוחה/);
  });

  it("processTranscriptAccuracy blocks risky low-confidence action transcripts", async () => {
    const result = await processTranscriptAccuracy({
      organizationId: "org-1",
      rawTranscript: "אשרי תשלום",
      vocabulary,
    });
    assert.equal(result.actionBlocked, true);
    assert.equal(result.clarificationRequired, true);
    assert.ok(result.clarificationMessage);
  });

  it("processTranscriptAccuracy normalizes mixed Hebrew business speech", async () => {
    const result = await processTranscriptAccuracy({
      organizationId: "org-1",
      rawTranscript: "כמה שילמתי לחברת חשמל החודש",
      vocabulary,
      skipClarification: true,
    });
    assert.match(result.normalizedTranscript, /חברת החשמל/);
    assert.ok(result.confidence > 0.6);
  });

  it("records stt accuracy metrics with redaction", () => {
    recordSttAccuracyMetric({
      organizationId: "org-1",
      result: {
        rawTranscript: "הטלפון 0521234567",
        normalizedTranscript: "הטלפון 0521234567",
        confidence: 0.7,
        confidenceLevel: "medium",
        corrections: [],
        clarificationRequired: false,
        clarificationMessage: null,
        actionBlocked: false,
        detectedActions: [],
        ambiguousNameSuggestions: [],
      },
      redact: true,
    });
    const snapshots = getSttAccuracyMetricSnapshots();
    assert.equal(snapshots.length, 1);
    assert.match(snapshots[0]!.rawTranscript, /\[phone\]/);
  });

  it("handles unclear similar-sounding supplier tokens without auto-correcting aggressively", async () => {
    const unclearVocabulary: SttVocabulary = {
      ...vocabulary,
      supplierNames: ["בזק", "בלק"],
    };
    const result = await processTranscriptAccuracy({
      organizationId: "org-1",
      rawTranscript: "חשבונית מבלק",
      vocabulary: unclearVocabulary,
      skipClarification: true,
    });
    assert.ok(result.corrections.length <= 2);
  });

  it("handles supplier names with regex metacharacters without throwing", async () => {
    const pollutedVocabulary: SttVocabulary = {
      ...vocabulary,
      supplierNames: [...vocabulary.supplierNames, "normalizeDetectedAmount(result.totalAmount"],
    };
    assert.doesNotThrow(() =>
      correctBusinessNamesInTranscript("שלום", pollutedVocabulary)
    );
    await processTranscriptAccuracy({
      organizationId: "org-1",
      rawTranscript: "כמה שילמתי החודש",
      vocabulary: pollutedVocabulary,
      skipClarification: true,
    });
  });

  it("preserves invoice-like identifiers in transcript", async () => {
    const result = await processTranscriptAccuracy({
      organizationId: "org-1",
      rawTranscript: "חשבונית מספר איי 1234",
      vocabulary,
      skipClarification: true,
    });
    assert.match(result.normalizedTranscript, /איי 1234|A-1234|1234/i);
  });
});
