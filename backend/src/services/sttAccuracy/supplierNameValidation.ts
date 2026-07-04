export const MAX_SUPPLIER_NAME_LENGTH = 80;
export const MAX_SUPPLIER_SYMBOL_DENSITY = 0.35;

export type SupplierNameRejectReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "code_fragment"
  | "high_symbol_density"
  | "abnormal_punctuation";

const CODE_FRAGMENT_PATTERNS = [
  /\bfunction\b/i,
  /\breturn\b/i,
  /\bconst\b/i,
  /\blet\b/i,
  /\bvar\b/i,
  /=>/,
  /result\./i,
  /normalizeDetected/i,
  /\.totalAmount/i,
  /undefined|null/,
  /\(\(\)\(\)\)/,
  /\(\s*\)\s*\(\s*\)/,
];

const BUSINESS_PUNCTUATION = /[\p{L}\p{N}\s.,'\-&"()/]/gu;

export function assessSupplierNameForStt(
  name: string
): { ok: true; value: string } | { ok: false; reason: SupplierNameRejectReason } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length < 2) return { ok: false, reason: "too_short" };
  if (trimmed.length > MAX_SUPPLIER_NAME_LENGTH) return { ok: false, reason: "too_long" };

  if (CODE_FRAGMENT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { ok: false, reason: "code_fragment" };
  }

  const openParens = (trimmed.match(/\(/g) ?? []).length;
  const closeParens = (trimmed.match(/\)/g) ?? []).length;
  const openBrackets = (trimmed.match(/\[/g) ?? []).length;
  const closeBrackets = (trimmed.match(/\]/g) ?? []).length;
  if (openParens !== closeParens || openBrackets !== closeBrackets) {
    return { ok: false, reason: "abnormal_punctuation" };
  }

  if (/[*+?|^${}\\]/.test(trimmed)) {
    return { ok: false, reason: "abnormal_punctuation" };
  }

  const symbolChars = trimmed.replace(BUSINESS_PUNCTUATION, "");
  const density = symbolChars.length / trimmed.length;
  if (density > MAX_SUPPLIER_SYMBOL_DENSITY) {
    return { ok: false, reason: "high_symbol_density" };
  }

  if (/[^\p{L}\p{N}\s]{3,}/u.test(trimmed)) {
    return { ok: false, reason: "abnormal_punctuation" };
  }

  return { ok: true, value: trimmed };
}

export function isValidSupplierNameForStt(name: string): boolean {
  return assessSupplierNameForStt(name).ok;
}

export function filterSupplierNamesForStt(names: string[]): {
  accepted: string[];
  ignoredCount: number;
  ignoredByReason: Partial<Record<SupplierNameRejectReason, number>>;
} {
  const accepted: string[] = [];
  const ignoredByReason: Partial<Record<SupplierNameRejectReason, number>> = {};

  for (const name of names) {
    const assessment = assessSupplierNameForStt(name);
    if (assessment.ok) {
      accepted.push(assessment.value);
      continue;
    }
    ignoredByReason[assessment.reason] = (ignoredByReason[assessment.reason] ?? 0) + 1;
  }

  return {
    accepted: [...new Set(accepted)],
    ignoredCount: names.length - accepted.length,
    ignoredByReason,
  };
}

type HygieneCounters = {
  totalCandidates: number;
  ignoredTotal: number;
  ignoredByReason: Partial<Record<SupplierNameRejectReason, number>>;
  vocabularyBuilds: number;
};

let hygieneCounters: HygieneCounters = {
  totalCandidates: 0,
  ignoredTotal: 0,
  ignoredByReason: {},
  vocabularyBuilds: 0,
};

export function recordSupplierNameHygieneScan(input: {
  candidateCount: number;
  ignoredCount: number;
  ignoredByReason: Partial<Record<SupplierNameRejectReason, number>>;
}): void {
  hygieneCounters.vocabularyBuilds += 1;
  hygieneCounters.totalCandidates += input.candidateCount;
  hygieneCounters.ignoredTotal += input.ignoredCount;
  for (const [reason, count] of Object.entries(input.ignoredByReason)) {
    if (!count) continue;
    const key = reason as SupplierNameRejectReason;
    hygieneCounters.ignoredByReason[key] = (hygieneCounters.ignoredByReason[key] ?? 0) + count;
  }

  if (input.ignoredCount > 0) {
    console.info("[stt/supplier-vocabulary] ignored malformed supplier names", {
      candidateCount: input.candidateCount,
      ignoredCount: input.ignoredCount,
      ignoredByReason: input.ignoredByReason,
    });
  }
}

export function getSupplierNameHygieneSnapshot(): HygieneCounters {
  return {
    totalCandidates: hygieneCounters.totalCandidates,
    ignoredTotal: hygieneCounters.ignoredTotal,
    ignoredByReason: { ...hygieneCounters.ignoredByReason },
    vocabularyBuilds: hygieneCounters.vocabularyBuilds,
  };
}

export function resetSupplierNameHygieneMetrics(): void {
  hygieneCounters = {
    totalCandidates: 0,
    ignoredTotal: 0,
    ignoredByReason: {},
    vocabularyBuilds: 0,
  };
}
