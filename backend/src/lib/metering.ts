import type { OrgUsageProvider, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  calculateAnthropicHaikuCostUsd,
  calculateElevenLabsCostUsd,
  calculateOpenAiTtsCostUsd,
  calculateTwilioWhatsAppCostUsd,
  calculateWhisperCostUsd,
  monthlyWarnThresholdUsd,
  type AnthropicUsageUnits,
  type ElevenLabsUsageUnits,
  type OpenAiTtsUsageUnits,
  type TwilioUsageUnits,
  type WhisperUsageUnits,
} from "./cost-calculator.js";

export type UsageDetails =
  | ({ kind: "anthropic" } & AnthropicUsageUnits)
  | ({ kind: "whisper" } & WhisperUsageUnits)
  | ({ kind: "openai_tts" } & OpenAiTtsUsageUnits)
  | ({ kind: "elevenlabs" } & ElevenLabsUsageUnits)
  | ({ kind: "twilio" } & TwilioUsageUnits);

export type LogUsageEventInput = {
  orgId: string;
  provider: OrgUsageProvider;
  feature: string;
  usageDetails: UsageDetails;
  metadata?: Record<string, unknown>;
};

function resolveCost(details: UsageDetails): {
  units: number;
  estimatedCostUsd: number;
  metadata: Record<string, unknown>;
} {
  switch (details.kind) {
    case "anthropic": {
      const calc = calculateAnthropicHaikuCostUsd(details);
      return {
        units: calc.units,
        estimatedCostUsd: calc.estimatedCostUsd,
        metadata: { inputTokens: details.inputTokens, outputTokens: details.outputTokens },
      };
    }
    case "whisper": {
      const calc = calculateWhisperCostUsd(details);
      return {
        units: calc.units,
        estimatedCostUsd: calc.estimatedCostUsd,
        metadata: { durationSeconds: details.durationSeconds, billedSeconds: calc.units },
      };
    }
    case "openai_tts": {
      const calc = calculateOpenAiTtsCostUsd(details);
      return {
        units: calc.units,
        estimatedCostUsd: calc.estimatedCostUsd,
        metadata: {
          textChars: details.textChars,
          audioDurationSeconds: details.audioDurationSeconds,
          textTokens: calc.textTokens,
          audioTokens: calc.audioTokens,
        },
      };
    }
    case "elevenlabs": {
      const calc = calculateElevenLabsCostUsd(details);
      return {
        units: calc.units,
        estimatedCostUsd: calc.estimatedCostUsd,
        metadata: { characters: details.characters },
      };
    }
    case "twilio": {
      const calc = calculateTwilioWhatsAppCostUsd(details);
      return {
        units: calc.units,
        estimatedCostUsd: calc.estimatedCostUsd,
        metadata: { messageCount: details.messageCount },
      };
    }
    default:
      return { units: 0, estimatedCostUsd: 0, metadata: {} };
  }
}

/**
 * Fire-and-forget usage logger. NEVER await from hot paths that must stay non-blocking —
 * call as `void logUsageEvent(...)`.
 */
export async function logUsageEvent(input: LogUsageEventInput): Promise<void> {
  const orgId = input.orgId?.trim();
  if (!orgId) return;

  try {
    const resolved = resolveCost(input.usageDetails);
    await prisma.orgUsageEvent.create({
      data: {
        orgId,
        provider: input.provider,
        feature: input.feature,
        units: resolved.units,
        estimatedCostUsd: resolved.estimatedCostUsd,
        metadata: {
          ...resolved.metadata,
          ...(input.metadata ?? {}),
        } as Prisma.InputJsonValue,
      },
    });

    void warnIfMonthlyCostExceeded(orgId).catch((err) => {
      console.warn(
        "[metering] monthly cost warn check failed",
        err instanceof Error ? err.message : String(err)
      );
    });
  } catch (err) {
    console.warn(
      "[metering] logUsageEvent failed (non-blocking)",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export async function getOrgMonthlyCost(
  orgId: string,
  year: number,
  month: number
): Promise<{ totalUsd: number; eventCount: number; year: number; month: number }> {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const agg = await prisma.orgUsageEvent.aggregate({
    where: {
      orgId,
      createdAt: { gte: start, lt: end },
    },
    _sum: { estimatedCostUsd: true },
    _count: { _all: true },
  });
  const totalUsd = Number(agg._sum.estimatedCostUsd ?? 0);
  return {
    totalUsd: Number.isFinite(totalUsd) ? totalUsd : 0,
    eventCount: agg._count._all,
    year,
    month,
  };
}

const warnedOrgsThisProcess = new Set<string>();

async function warnIfMonthlyCostExceeded(orgId: string): Promise<void> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const key = `${orgId}:${year}-${month}`;
  if (warnedOrgsThisProcess.has(key)) return;

  const planId = await resolveOrgPlanId(orgId);
  const threshold = monthlyWarnThresholdUsd(planId);
  const { totalUsd } = await getOrgMonthlyCost(orgId, year, month);
  if (totalUsd < threshold) return;

  warnedOrgsThisProcess.add(key);
  const message = `[metering] org ${orgId} monthly estimated COGS $${totalUsd.toFixed(4)} exceeded warn threshold $${threshold} (plan=${planId ?? "default"})`;
  console.warn(message);
  try {
    const Sentry = await import("@sentry/node");
    Sentry.captureMessage(message, {
      level: "warning",
      tags: { metering: "monthly_cost_warn", organizationId: orgId },
      extra: { totalUsd, threshold, planId, year, month },
    });
  } catch {
    // Sentry optional
  }
}

async function resolveOrgPlanId(orgId: string): Promise<string | null> {
  try {
    const row = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider: "stripe" } },
      select: { metadata: true },
    });
    const metadata =
      row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const planId = metadata.planId;
    return typeof planId === "string" ? planId : null;
  } catch {
    return null;
  }
}

/** Test helper — reset warn dedupe. */
export function resetMeteringWarnCacheForTests() {
  warnedOrgsThisProcess.clear();
}
