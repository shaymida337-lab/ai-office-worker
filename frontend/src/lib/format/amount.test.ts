import test from "node:test";
import assert from "node:assert/strict";
import { formatAmount, formatAmountValue, MISSING_AMOUNT_LABEL } from "./amount";

// כמה ספרות עשרוניות יש בפלט מעוצב (החלק שאחרי הנקודה, ספרות בלבד)
function decimalDigits(formatted: string): number {
  const match = formatted.match(/\.(\d+)/);
  return match ? match[1].length : 0;
}

test("formatted amount never contains more than 2 decimal digits", () => {
  // הרגרסיה המקורית: 920219.813 הוצג כ-"920,219.813 ₪" — ברירת המחדל של
  // toLocaleString("he-IL") היא עד 3 ספרות עשרוניות
  const amounts = [920219.813, 0.005, 1234.5678, 99.999, 1_000_000.001, 43.9, 163.28, 119, 0.1 + 0.2];
  for (const amount of amounts) {
    for (const formatted of [formatAmountValue(amount), formatAmount(amount)]) {
      assert.ok(
        decimalDigits(formatted) <= 2,
        `expected <=2 decimal digits, got "${formatted}" for ${amount}`
      );
    }
  }
});

test("formatAmountValue keeps the regression value at 2 decimals", () => {
  assert.equal(formatAmountValue(920219.813), "920,219.81");
  assert.equal(formatAmountValue(1234.5), "1,234.5");
  assert.equal(formatAmountValue(119), "119");
});

test("formatAmount: null/undefined/NaN never crash — render missing label", () => {
  assert.equal(formatAmount(null), MISSING_AMOUNT_LABEL);
  assert.equal(formatAmount(undefined), MISSING_AMOUNT_LABEL);
  assert.equal(formatAmount(Number.NaN), MISSING_AMOUNT_LABEL);
  assert.equal(formatAmount(null, "ILS", "סכום חסר"), "סכום חסר");
});

test("formatAmount: valid amounts keep the existing display format", () => {
  assert.equal(formatAmount(1234.5), "₪ 1,234.5");
  assert.equal(formatAmount(0), "₪ 0");
  assert.equal(formatAmount(100, "USD"), "$ 100");
  assert.equal(formatAmount(100, "EUR"), "€ 100");
  // מטבע לא מוכר — הקוד עצמו מוצג
  assert.equal(formatAmount(100, "CHF"), "CHF 100");
});
