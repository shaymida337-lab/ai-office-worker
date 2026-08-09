import { logUsageEvent } from "./metering.js";

/** Fire-and-forget Anthropic token metering from a messages.create response. */
export function meterAnthropicResponse(
  organizationId: string | null | undefined,
  feature: string,
  message: { usage?: { input_tokens?: number; output_tokens?: number } | null },
  metadata?: Record<string, unknown>
): void {
  const orgId = organizationId?.trim();
  if (!orgId) return;
  void logUsageEvent({
    orgId,
    provider: "ANTHROPIC",
    feature,
    usageDetails: {
      kind: "anthropic",
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    },
    metadata,
  });
}
