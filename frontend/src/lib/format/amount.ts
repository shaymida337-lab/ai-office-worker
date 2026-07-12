/**
 * פורמט סכומים אחיד — נקודת אמת אחת במקום formatCurrency משוכפל.
 *
 * סכום null/undefined/NaN לעולם לא קורס — מוצג "—" (או תווית שהקורא בוחר).
 * הפלט לערכים תקינים זהה לפורמט הקיים: "₪ 1,234.5".
 */

const CURRENCY_SYMBOLS: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };

export const MISSING_AMOUNT_LABEL = "—";

/**
 * המספר בלבד, בלי סמל — לעולם לא יותר מ-2 ספרות עשרוניות.
 * בלי maximumFractionDigits, toLocaleString ברירת המחדל היא 3 ספרות —
 * כך "920219.813" שנשמר גולמי הוצג כ-"920,219.813 ₪". כל אתר שמעצב
 * סכום כסף חייב לעבור דרך הפונקציה הזו (או formatAmount).
 */
export function formatAmountValue(amount: number): string {
  return amount.toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

export function formatAmount(
  amount: number | null | undefined,
  currency: string = "ILS",
  missingLabel: string = MISSING_AMOUNT_LABEL
): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return missingLabel;
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${symbol} ${formatAmountValue(amount)}`;
}
