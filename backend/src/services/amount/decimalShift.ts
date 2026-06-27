import { roundMoney } from "./parseAmountHelpers.js";

export type DecimalShiftMatch = {
  factor: 10 | 100;
  adjustedAmount: number;
  referenceAmount: number;
  reason: string;
};

const TOLERANCE = 0.05;

function close(a: number, b: number) {
  const delta = Math.abs(a - b);
  return delta <= TOLERANCE || delta / Math.max(Math.abs(b), 1) <= 0.01;
}

/**
 * Detect if `amount` is likely a ×10 or ×100 misread of `reference`.
 */
export function detectDecimalShift(amount: number, reference: number): DecimalShiftMatch | null {
  if (!Number.isFinite(amount) || !Number.isFinite(reference) || reference <= 0) return null;
  for (const factor of [100, 10] as const) {
    const adjusted = roundMoney(amount / factor);
    if (close(adjusted, reference)) {
      return {
        factor,
        adjustedAmount: adjusted,
        referenceAmount: reference,
        reason: `amount ${amount} may be ${factor}x misread of ${reference}`,
      };
    }
  }
  return null;
}

/**
 * Compare two payable totals for material conflict or decimal-shift relationship.
 */
export function amountsMateriallyConflict(a: number, b: number): boolean {
  if (close(a, b)) return false;
  if (detectDecimalShift(a, b) || detectDecimalShift(b, a)) return true;
  const max = Math.max(Math.abs(a), Math.abs(b));
  const min = Math.min(Math.abs(a), Math.abs(b));
  if (max === 0) return false;
  return (max - min) / max > 0.05;
}

export function findDecimalShiftAmongCandidates(amounts: number[]): DecimalShiftMatch | null {
  const unique = [...new Set(amounts.filter((v) => Number.isFinite(v) && v > 0))];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const shift = detectDecimalShift(unique[i], unique[j]) ?? detectDecimalShift(unique[j], unique[i]);
      if (shift) return shift;
    }
  }
  return null;
}
