import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseAmountOrNull } from "./parseAmount.js";

test("parseAmount: standard Israeli/US grouped decimals", () => {
  assert.equal(parseAmount("1,107.23").parsedAmount, 1107.23);
  assert.equal(parseAmount("1,107.23").ambiguous, false);
  assert.equal(parseAmount("1,107.00").parsedAmount, 1107);
  assert.equal(parseAmount("1107.23").parsedAmount, 1107.23);
  assert.equal(parseAmount("1.107,23").parsedAmount, 1107.23);
  assert.equal(parseAmount("₪1,107.23").parsedAmount, 1107.23);
  assert.equal(parseAmount('סה"כ לתשלום 1,107.23').parsedAmount, 1107.23);
});

test("parseAmount: ambiguous separator forms without label", () => {
  for (const raw of ["110,723", "110.723", "11.800"]) {
    const result = parseAmount(raw);
    assert.equal(result.parsedAmount, null, raw);
    assert.equal(result.ambiguous, true, raw);
  }
});

test("parseAmount: labeled ambiguous forms are never guessed (F3 conservative rule)", () => {
  // בעבר: 110.723 עם תווית חזקה נפרש כ-110,723. עכשיו: בספק → null → review.
  for (const raw of ["110.723", "110,723", "11.800", "1.5000", "1,5"]) {
    const result = parseAmount(raw, { stronglyLabeled: true });
    assert.equal(result.parsedAmount, null, raw);
    assert.equal(result.ambiguous, true, raw);
  }
});

test("parseAmount: real Israeli amount forms parse correctly (bidirectional)", () => {
  // אגורות
  assert.equal(parseAmount("89.90").parsedAmount, 89.9);
  assert.equal(parseAmount("0.50").parsedAmount, 0.5);
  // אלפים עם פסיק בפורמט ישראלי/US
  assert.equal(parseAmount("1,234.56").parsedAmount, 1234.56);
  assert.equal(parseAmount("12,345.00").parsedAmount, 12345);
  assert.equal(parseAmount("1,500", { stronglyLabeled: true }).parsedAmount, 1500);
  assert.equal(parseAmount("12,500", { stronglyLabeled: true }).parsedAmount, 12500);
  // סימני מטבע — ₪ / ש"ח / NIS
  assert.equal(parseAmount("₪ 350").parsedAmount, 350);
  assert.equal(parseAmount('350 ש"ח').parsedAmount, 350);
  assert.equal(parseAmount("350 NIS").parsedAmount, 350);
  assert.equal(parseAmount('סה"כ לתשלום 1,107.23').parsedAmount, 1107.23);
  // ערכים שנפרשו — לעולם לא מסומנים דו-משמעיים
  assert.equal(parseAmount("1,500", { stronglyLabeled: true }).ambiguous, false);
});

test("parseAmountOrNull returns null for ambiguous", () => {
  assert.equal(parseAmountOrNull("110,723"), null);
  assert.equal(parseAmountOrNull("1,107.23"), 1107.23);
});

test("parseAmount: MAX-style receipt total", () => {
  assert.equal(parseAmount("1,107.23").parsedAmount, 1107.23);
  assert.equal(parseAmountOrNull("110723"), 110723);
  assert.equal(parseAmountOrNull("110.723"), null);
});
