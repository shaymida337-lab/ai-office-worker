export type AiDriftMetric = {
  metric: string;
  description: string;
  alertThreshold: string;
};

export const AI_DRIFT_METRICS: readonly AiDriftMetric[] = [
  drift("amount_accuracy", "Correct amount extraction rate", "drop > 5% vs 30d baseline"),
  drift("supplier_accuracy", "Correct supplier identification rate", "drop > 5% vs baseline"),
  drift("document_type_accuracy", "Correct document classification rate", "drop > 5% vs baseline"),
  drift("needs_review_rate", "Documents routed to review", "spike > 20% vs baseline"),
  drift("blocked_rate", "Documents blocked", "spike > 50% vs baseline"),
  drift("auto_save_rate", "Documents auto-saved", "spike > 10% vs baseline"),
  drift("missing_amount_rate", "Financial docs with missing amount", "spike > 5% vs baseline"),
  drift("confidence_distribution", "Confidence score distribution shift", "KS test p < 0.05"),
];

function drift(metric: string, description: string, alertThreshold: string): AiDriftMetric {
  return { metric, description, alertThreshold };
}

export type AiDriftReport = {
  generatedAt: string;
  baselinePeriodDays: number;
  comparisons: Array<{
    metric: string;
    baselineValue: number;
    currentValue: number;
    deltaPercent: number;
    alertTriggered: boolean;
  }>;
  alertsTriggered: number;
};

export function detectAiModelDrift(input: {
  baseline: Record<string, number>;
  current: Record<string, number>;
  baselinePeriodDays?: number;
}): AiDriftReport {
  const comparisons = AI_DRIFT_METRICS.map((m) => {
    const baselineValue = input.baseline[m.metric] ?? 0;
    const currentValue = input.current[m.metric] ?? 0;
    const deltaPercent =
      baselineValue > 0 ? ((currentValue - baselineValue) / baselineValue) * 100 : 0;
    const alertTriggered = Math.abs(deltaPercent) > 5;
    return { metric: m.metric, baselineValue, currentValue, deltaPercent, alertTriggered };
  });

  return {
    generatedAt: new Date().toISOString(),
    baselinePeriodDays: input.baselinePeriodDays ?? 30,
    comparisons,
    alertsTriggered: comparisons.filter((c) => c.alertTriggered).length,
  };
}

export function listAiDriftMetrics(): AiDriftMetric[] {
  return [...AI_DRIFT_METRICS];
}
