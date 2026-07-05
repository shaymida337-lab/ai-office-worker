/**
 * פורמט סכומים אחיד — נקודת אמת אחת במקום formatCurrency משוכפל.
 *
 * סכום null/undefined/NaN לעולם לא קורס — מוצג "—" (או תווית שהקורא בוחר).
 * הפלט לערכים תקינים זהה לפורמט הקיים: "₪ 1,234.5".
 */

const CURRENCY_SYMBOLS: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };

export const MISSING_AMOUNT_LABEL = "—";

export function formatAmount(
  amount: number | null | undefined,
  currency: string = "ILS",
  missingLabel: string = MISSING_AMOUNT_LABEL
): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return missingLabel;
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${symbol} ${amount.toLocaleString("he-IL")}`;
}
