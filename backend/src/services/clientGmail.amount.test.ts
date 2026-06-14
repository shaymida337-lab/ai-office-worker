import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmailAnalysisAmountFields } from "./claude.js";

test("client Gmail email analysis amount uses OCR raw text to correct numeric AI amount", () => {
  const amounts = normalizeEmailAnalysisAmountFields(
    {
      amount: 11.8,
      amountBeforeVat: null,
      vatAmount: null,
      totalAmount: null,
    },
    { ocrRawText: "סה״כ לתשלום 11,800" }
  );

  assert.equal(amounts.amount, 11800);
  assert.notEqual(amounts.amount, 11.8);
});
