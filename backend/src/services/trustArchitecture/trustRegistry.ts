import type { NatalieTrustPrinciple, TrustSubsystemEntry, TrustVerificationCategory } from "./trustTypes.js";
import { TRUST_VERIFICATION_CATEGORIES } from "./trustTypes.js";
import { RELIABILITY_SUBSYSTEM_IDS } from "../reliability/reliabilityTypes.js";

function scaffolded(): Record<TrustVerificationCategory, "not_assessed"> {
  return Object.fromEntries(
    TRUST_VERIFICATION_CATEGORIES.map((c) => [c, "not_assessed"]),
  ) as Record<TrustVerificationCategory, "not_assessed">;
}

function partialAssessed(): TrustSubsystemEntry["verification"] {
  const base = scaffolded();
  return {
    ...base,
    reliability: "green",
    observability: "green",
    testability: "yellow",
    explainability: "yellow",
    auditability: "yellow",
    isolation: "green",
    security: "yellow",
    permissions: "not_assessed",
    recoverability: "not_assessed",
    performance: "not_assessed",
  };
}

export const TRUST_REGISTRY: readonly TrustSubsystemEntry[] = [
  ...RELIABILITY_SUBSYSTEM_IDS.map((subsystemId) => ({
    subsystemId,
    label: subsystemId.replace(/_/g, " "),
    verification: partialAssessed(),
    productionReady: false,
    principles: [
      "never_guess",
      "measurable_decisions",
      "fail_safely",
      "trust_requires_verification",
    ] as NatalieTrustPrinciple[],
  })),
  {
    subsystemId: "business_rules_engine" as const,
    label: "Business Rules Engine",
    verification: {
      ...scaffolded(),
      testability: "green",
      explainability: "green",
      reliability: "yellow",
    },
    productionReady: false,
    principles: ["never_guess", "explainable_financial_actions", "fail_safely"] as NatalieTrustPrinciple[],
  },
  {
    subsystemId: "trust_platform" as const,
    label: "Trust Platform",
    verification: {
      ...scaffolded(),
      observability: "green",
      testability: "green",
    },
    productionReady: false,
    principles: ["never_guess", "trust_requires_verification"] as NatalieTrustPrinciple[],
  },
];

export function getTrustRegistryEntry(
  subsystemId: TrustSubsystemEntry["subsystemId"],
): TrustSubsystemEntry | undefined {
  return TRUST_REGISTRY.find((e) => e.subsystemId === subsystemId);
}

export function allCategoriesGreen(
  verification: TrustSubsystemEntry["verification"],
): boolean {
  return TRUST_VERIFICATION_CATEGORIES.every((c) => verification[c] === "green");
}

export function evaluateSubsystemReadiness(
  subsystemId: TrustSubsystemEntry["subsystemId"],
): { ready: boolean; gaps: TrustVerificationCategory[] } {
  const entry = getTrustRegistryEntry(subsystemId);
  if (!entry) return { ready: false, gaps: [...TRUST_VERIFICATION_CATEGORIES] };
  const gaps = TRUST_VERIFICATION_CATEGORIES.filter((c) => entry.verification[c] !== "green");
  return { ready: gaps.length === 0, gaps };
}

export function listNonReadySubsystems(): TrustSubsystemEntry[] {
  return TRUST_REGISTRY.filter((e) => !allCategoriesGreen(e.verification));
}
