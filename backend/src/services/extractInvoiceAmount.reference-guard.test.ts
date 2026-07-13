import assert from "node:assert/strict";
import { test } from "node:test";
import { extractInvoiceAmount } from "./gmail-sync.js";

test("explicit currency amount next to an invoice identifier is NOT rejected (Microsoft G169777544 regression)", () => {
  const result = extractInvoiceAmount(
    "Your invoice # G169777544 amount $114.00 is now available."
  );
  assert.equal(result.amount, 114);
  assert.equal(result.rejectedReason, null);
});

test("explicit currency amount variants near a reference all resolve", () => {
  assert.equal(extractInvoiceAmount("Invoice number G169777544 amount USD 114.00").amount, 114);
  assert.equal(extractInvoiceAmount("invoice # G169777544 amount 114.00 USD").amount, 114);
  // עברית: תווית מתועדפת עם מטבע — הכלל הקיים נשמר.
  // (הערה: "מספר/מס" בתוך 25 תווים לפני הסכום נפסל ע"י שומר אחר —
  // isLikelyIdentifierNumber — שאינו בהיקף התיקון הזה.)
  assert.equal(extractInvoiceAmount("חשבונית עבור יולי. סכום לתשלום 114.00 ₪").amount, 114);
});

test("the invoice identifier itself is never selected as the amount", () => {
  // "Total amount for invoice G169777544" — הפער בתבנית עלול ללכוד את המזהה;
  // isLikelyIdentifierNumber (9 ספרות, בלי עשרוניות) חייב לפסול אותו תמיד.
  const swallowed = extractInvoiceAmount("Total amount for invoice G169777544");
  assert.equal(swallowed.amount, null);

  const withReal = extractInvoiceAmount("Total amount for invoice G169777544 USD 114.00");
  assert.equal(withReal.amount, 114);
  assert.notEqual(withReal.amount, 169777544);
});

test("order/invoice number without a clear monetary amount is still rejected near a reference", () => {
  // סכום עירום (בלי מטבע ובלי עשרוניות) ליד reference — נשאר נפסל
  const bare = extractInvoiceAmount("invoice # G169777544 amount 114 is listed");
  assert.equal(bare.amount, null);
  assert.equal(bare.rejectedReason, "parsed amount rejected: nearby reference/document number context");

  // מספר הזמנה ארוך שנתפס כמועמד ליד reference — נפסל (אין עשרוניות)
  const orderNum = extractInvoiceAmount("amount 12345678 for order number INV12345678");
  assert.equal(orderNum.amount, null);
});
