import { prisma } from "../../lib/prisma.js";
import type { ConfidenceThresholds } from "./confidenceTypes.js";

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  autoExecuteMin: 0.9,
  reviewRequiredMin: 0.6,
  blockedBelow: 0.6,
};

export type ConfidenceConfigDb = Pick<typeof prisma, "organization">;

export function parseConfidenceThresholdsJson(value: unknown): ConfidenceThresholds {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CONFIDENCE_THRESHOLDS };
  }
  const raw = value as Record<string, unknown>;
  const autoExecuteMin = parseThreshold(raw.autoExecuteMin, DEFAULT_CONFIDENCE_THRESHOLDS.autoExecuteMin);
  const reviewRequiredMin = parseThreshold(raw.reviewRequiredMin, DEFAULT_CONFIDENCE_THRESHOLDS.reviewRequiredMin);
  const blockedBelow = parseThreshold(raw.blockedBelow, reviewRequiredMin);
  return {
    autoExecuteMin: Math.max(reviewRequiredMin, autoExecuteMin),
    reviewRequiredMin: Math.min(autoExecuteMin, reviewRequiredMin),
    blockedBelow: Math.min(reviewRequiredMin, blockedBelow),
  };
}

function parseThreshold(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

export async function loadConfidenceThresholds(
  organizationId: string,
  db: ConfidenceConfigDb = prisma,
): Promise<ConfidenceThresholds> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { confidenceThresholdsJson: true },
  });
  return parseConfidenceThresholdsJson(org?.confidenceThresholdsJson ?? null);
}
