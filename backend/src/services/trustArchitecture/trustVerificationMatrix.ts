import type { TrustSubsystemEntry, TrustVerificationCategory } from "./trustTypes.js";
import { TRUST_VERIFICATION_CATEGORIES } from "./trustTypes.js";
import { TRUST_REGISTRY } from "./trustRegistry.js";

export type TrustVerificationMatrixRow = {
  subsystemId: TrustSubsystemEntry["subsystemId"];
  label: string;
  categories: Record<TrustVerificationCategory, TrustSubsystemEntry["verification"][TrustVerificationCategory]>;
  allGreen: boolean;
  productionReady: boolean;
};

export type TrustVerificationMatrix = {
  generatedAt: string;
  rows: TrustVerificationMatrixRow[];
  subsystemsReady: number;
  subsystemsTotal: number;
  categoriesAssessed: Record<
    TrustVerificationCategory,
    { green: number; yellow: number; red: number; notAssessed: number }
  >;
};

export function buildTrustVerificationMatrix(generatedAt?: string): TrustVerificationMatrix {
  const rows: TrustVerificationMatrixRow[] = TRUST_REGISTRY.map((entry) => ({
    subsystemId: entry.subsystemId,
    label: entry.label,
    categories: { ...entry.verification },
    allGreen: TRUST_VERIFICATION_CATEGORIES.every((c) => entry.verification[c] === "green"),
    productionReady: entry.productionReady,
  }));

  const categoriesAssessed = Object.fromEntries(
    TRUST_VERIFICATION_CATEGORIES.map((category) => [
      category,
      {
        green: rows.filter((r) => r.categories[category] === "green").length,
        yellow: rows.filter((r) => r.categories[category] === "yellow").length,
        red: rows.filter((r) => r.categories[category] === "red").length,
        notAssessed: rows.filter((r) => r.categories[category] === "not_assessed").length,
      },
    ]),
  ) as TrustVerificationMatrix["categoriesAssessed"];

  return {
    generatedAt: generatedAt ?? new Date().toISOString(),
    rows,
    subsystemsReady: rows.filter((r) => r.allGreen && r.productionReady).length,
    subsystemsTotal: rows.length,
    categoriesAssessed,
  };
}

export function isMatrixLaunchReady(matrix: TrustVerificationMatrix): boolean {
  return matrix.rows.every((r) => r.allGreen);
}

export function listMatrixGaps(matrix: TrustVerificationMatrix): Array<{
  subsystemId: string;
  category: TrustVerificationCategory;
  status: string;
}> {
  const gaps: Array<{ subsystemId: string; category: TrustVerificationCategory; status: string }> = [];
  for (const row of matrix.rows) {
    for (const category of TRUST_VERIFICATION_CATEGORIES) {
      if (row.categories[category] !== "green") {
        gaps.push({ subsystemId: row.subsystemId, category, status: row.categories[category] });
      }
    }
  }
  return gaps;
}
