import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveReviewSupplierContext,
  resolveSupplierNameForApproval,
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
