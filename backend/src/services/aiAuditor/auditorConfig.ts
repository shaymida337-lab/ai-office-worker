import { prisma } from "../../lib/prisma.js";
import type { AuditorConfig } from "./auditorTypes.js";

export const DEFAULT_AUDITOR_CONFIG: AuditorConfig = {
  enabled: false,
  amountTolerancePercent: 0.02,
  confidenceTolerance: 0.1,
  supplierMatchRequired: true,
};

export type AuditorConfigDb = Pick<typeof prisma, "organization">;

export function parseAuditorConfigJson(value: unknown): AuditorConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_AUDITOR_CONFIG };
  }
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    amountTolerancePercent: parseNumber(raw.amountTolerancePercent, DEFAULT_AUDITOR_CONFIG.amountTolerancePercent, 0, 1),
    confidenceTolerance: parseNumber(raw.confidenceTolerance, DEFAULT_AUDITOR_CONFIG.confidenceTolerance, 0, 1),
    supplierMatchRequired: raw.supplierMatchRequired !== false,
  };
}

function parseNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export async function loadAuditorConfig(
  organizationId: string,
  db: AuditorConfigDb = prisma,
): Promise<AuditorConfig> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { aiAuditorConfigJson: true },
  });
  return parseAuditorConfigJson(org?.aiAuditorConfigJson ?? null);
}
