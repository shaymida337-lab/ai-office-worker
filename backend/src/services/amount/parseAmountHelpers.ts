export function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

/**
 * עיגול כספי סובלני-null לערכי fallback גולמיים (למשל analysis.amountBeforeVat
 * שמגיע מהמודל כמספר עם 3 ספרות עשרוניות). null/undefined/NaN → null.
 */
export function roundMoneyOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? roundMoney(value) : null;
}
