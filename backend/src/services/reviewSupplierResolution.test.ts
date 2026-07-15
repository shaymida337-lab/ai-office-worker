import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveReviewSupplierContext,
  resolveSupplierNameForApproval,
  normalizeSupplierPaymentKey,
} from "./reviewSupplierResolution.js";

test("Paz receipt with OCR misread displays פז and requires confirmation", () => {
  const result = resolveReviewSupplierContext({
    supplierName: "פרייזון",
    parsedFieldsJson: {
      rawOcrText: "קבלה תחנת פז דלק yellow סה\"כ 215.14",
      gates: [
        {
          gate: "supplier",
          verdict: "review",
          reasonCode: "supplier.sir_weak_evidence",
          canonicalSupplierName: "פרייזון",
        },
      ],
      sir: {
        supplierName: "פרייזון",
        status: "resolved",
        isStrongEnoughForAutoSave: false,
      },
    },
  });

  assert.equal(result.rawSupplierName, "פרייזון");
  assert.equal(result.displaySupplierName, "פז");
  assert.equal(result.supplierNeedsConfirmation, true);
  assert.equal(result.supplierUncertain, true);
});

test("Electric company document normalizes to חברת החשמל", () => {
  const result = resolveReviewSupplierContext({
    supplierName: "חברת החשמל לישראל בע\"מ",
    supplierTaxId: "520000391",
    parsedFieldsJson: {
      gates: [
        {
          gate: "supplier",
          verdict: "pass",
          reasonCode: "supplier.resolved",
          canonicalSupplierName: "חברת החשמל",
        },
      ],
      sir: {
        supplierName: "חברת החשמל לישראל בע\"מ",
        canonicalSupplier: "חברת החשמל",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
      },
    },
  });

  assert.equal(result.displaySupplierName, "חברת החשמל");
});

test("low confidence supplier blocks approval without manual confirmation", () => {
  assert.throws(
    () =>
      resolveSupplierNameForApproval({
        supplierName: "פרייזון",
        parsedFieldsJson: {
          rawOcrText: "קבלה תחנת פז דלק",
          gates: [
            {
              gate: "supplier",
              verdict: "review",
              reasonCode: "supplier.sir_weak_evidence",
              canonicalSupplierName: "פרייזון",
            },
          ],
        },
      }),
    /supplier\.needs_confirmation/
  );
});

test("manual supplier confirmation allows approval with confirmed name", () => {
  const approved = resolveSupplierNameForApproval(
    {
      supplierName: "פרייזון",
      parsedFieldsJson: { rawOcrText: "קבלה תחנת פז דלק" },
    },
    "פז"
  );
  assert.equal(approved, "פז");
});

test("Claude=פז with IEC mention in OCR stays פז", () => {
  const result = resolveReviewSupplierContext({
    supplierName: "פז",
    rawAnalysis: { analysis: { supplier: "פז" } },
    parsedFieldsJson: {
      rawOcrText:
        "קבלה תחנת פז דלק yellow סה\"כ 215.14\nחשבון חשמל חברת החשמל לישראל מוזכר בטעות",
      sir: {
        supplierName: "פז",
        canonicalSupplier: "known:פז",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
        reasonCode: "OCR_KEYWORD",
      },
    },
  });

  assert.equal(result.displaySupplierName, "פז");
});

test("עיריית רמת גן with incidental IEC OCR does not become חברת החשמל", () => {
  const result = resolveReviewSupplierContext({
    supplierName: "עיריית רמת-גן",
    rawAnalysis: { analysis: { supplier: "לא ידוע" } },
    parsedFieldsJson: {
      rawOcrText: "דרישת תשלום עיריית רמת גן\nאזכור שולי: חברת החשמל",
    },
  });

  assert.equal(result.displaySupplierName, "עיריית רמת-גן");
  assert.notEqual(result.displaySupplierName, "חברת החשמל");
});

test("Claude=לא ידוע with weak IEC OCR does not auto-display חברת החשמל", () => {
  const result = resolveReviewSupplierContext({
    supplierName: "לא זוהה",
    rawAnalysis: { analysis: { supplier: "לא ידוע" } },
    parsedFieldsJson: {
      rawOcrText: "detection noise חברת החשמל random footer",
      sir: { status: "ambiguous", reasonCode: "AMBIGUOUS" },
    },
  });

  assert.equal(result.displaySupplierName, "לא זוהה");
  assert.notEqual(result.displaySupplierName, "חברת החשמל");
});

test("known:מירמתגן displays as מי רמת גן via SIR supplierName", () => {
  const result = resolveReviewSupplierContext({
    supplierName: "מי רמת גן",
    parsedFieldsJson: {
      sir: {
        supplierName: "מי רמת גן",
        canonicalSupplier: "known:מירמתגן",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
        reasonCode: "VAT_REGISTRY",
      },
    },
  });

  assert.equal(result.displaySupplierName, "מי רמת גן");
});

test("normalizeSupplierPaymentKey maps yellow to פז", () => {
  assert.equal(normalizeSupplierPaymentKey("yellow"), "פז");
  assert.equal(normalizeSupplierPaymentKey("known:פז"), "פז");
});

test("known:סופרפארם vs סופר פארם does not require supplier confirmation", () => {
  const result = resolveReviewSupplierContext({
    supplierName: "סופר פארם",
    parsedFieldsJson: {
      gates: [
        {
          gate: "supplier",
          verdict: "pass",
          reasonCode: "supplier.resolved",
          canonicalSupplierName: "known:סופרפארם",
        },
      ],
      sir: {
        supplierName: "סופר פארם",
        canonicalSupplier: "known:סופרפארם",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
        reasonCode: "OCR_KEYWORD",
      },
    },
  });

  assert.equal(result.displaySupplierName, "סופר פארם");
  assert.equal(result.normalizationApplied, false);
  assert.equal(result.supplierNeedsConfirmation, false);
  assert.equal(result.supplierConfidence, "high");
  const approved = resolveSupplierNameForApproval({
    supplierName: "סופר פארם",
    parsedFieldsJson: {
      gates: [
        {
          gate: "supplier",
          verdict: "pass",
          reasonCode: "supplier.resolved",
          canonicalSupplierName: "known:סופרפארם",
        },
      ],
      sir: {
        supplierName: "סופר פארם",
        canonicalSupplier: "known:סופרפארם",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
      },
    },
  });
  // Payment key may be compact (סופרפארם); must still approve without confirmation.
  assert.ok(approved === "סופר פארם" || approved === "סופרפארם");
});

test("truly different supplier still requires confirmation", () => {
  // Avoid registry aliases (e.g. וולט→Wolt) that would short-circuit before gate/SIR compare.
  const result = resolveReviewSupplierContext({
    supplierName: "פרייזון",
    parsedFieldsJson: {
      gates: [
        {
          gate: "supplier",
          verdict: "pass",
          reasonCode: "supplier.resolved",
          canonicalSupplierName: "known:סופרפארם",
        },
      ],
      sir: {
        supplierName: "פרייזון",
        canonicalSupplier: "known:סופרפארם",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
      },
    },
  });

  assert.equal(result.supplierNeedsConfirmation, true);
  assert.throws(
    () =>
      resolveSupplierNameForApproval({
        supplierName: "פרייזון",
        parsedFieldsJson: {
          gates: [
            {
              gate: "supplier",
              verdict: "pass",
              reasonCode: "supplier.resolved",
              canonicalSupplierName: "known:סופרפארם",
            },
          ],
        },
      }),
    /supplier\.needs_confirmation/
  );
});
