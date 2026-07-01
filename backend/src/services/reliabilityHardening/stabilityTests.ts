export type StabilitySoakMetric = {
  metric: string;
  threshold: string;
  description: string;
};

export const STABILITY_SOAK_METRICS: readonly StabilitySoakMetric[] = [
  metric("memory_growth", "< 10% over 24h", "No unbounded memory growth"),
  metric("queue_growth", "stable or draining", "Queue does not grow unbounded"),
  metric("stuck_jobs", "0 after 1h", "No jobs stuck beyond threshold"),
  metric("repeated_retries", "< 5% of jobs", "Retry rate within bounds"),
  metric("token_expiration", "auto-refresh succeeds", "OAuth tokens refreshed before expiry"),
  metric("scheduled_jobs", "all execute on time", "Cron jobs run reliably"),
  metric("db_connection_stability", "no connection pool exhaustion", "DB connections stable"),
];

function metric(metricName: string, threshold: string, description: string): StabilitySoakMetric {
  return { metric: metricName, threshold, description };
}

export type StabilitySoakReport = {
  durationHours: number;
  startedAt: string;
  completedAt: string | null;
  metrics: Array<StabilitySoakMetric & { observed: string; passed: boolean }>;
  passed: boolean;
};

export function buildStabilitySoakReport(input: {
  durationHours: number;
  observations: Record<string, { observed: string; passed: boolean }>;
}): StabilitySoakReport {
  const metrics = STABILITY_SOAK_METRICS.map((m) => ({
    ...m,
    observed: input.observations[m.metric]?.observed ?? "not measured",
    passed: input.observations[m.metric]?.passed ?? false,
  }));
  return {
    durationHours: input.durationHours,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    metrics,
    passed: metrics.every((m) => m.passed),
  };
}

export function listStabilityMetrics(): StabilitySoakMetric[] {
  return [...STABILITY_SOAK_METRICS];
}
