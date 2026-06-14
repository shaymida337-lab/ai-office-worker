import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAmountValue } from "./claude.js";

test("numeric AI amount is corrected when OCR raw text contains thousands amount", () => {
  const amount = normalizeAmountValue(11.8, { source: "ai_json", ocrRawText: "סה״כ לתשלום 11,800" });

  assert.equal(amount, 11800);
  assert.notEqual(amount, 11.8);
});
