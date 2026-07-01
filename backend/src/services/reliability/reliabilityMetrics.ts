import type {
  ReliabilityIsoTimestamp,
  ReliabilityMetricSample,
  ReliabilityMetricUnit,
  ReliabilityStandardMetricKey,
  ReliabilitySubsystemId,
} from "./reliabilityTypes.js";
import { RELIABILITY_STANDARD_METRIC_KEYS } from "./reliabilityTypes.js";

export const RELIABILITY_METRIC_UNITS: Record<ReliabilityStandardMetricKey, ReliabilityMetricUnit> =
  {
    availability: "ratio",
    success_rate: "ratio",
    failure_rate: "ratio",
    processing_latency: "milliseconds",
    retry_rate: "ratio",
    queue_depth: "count",
    stuck_jobs: "count",
    duplicate_rate: "ratio",
    false_positive_rate: "ratio",
  };

export type BuildReliabilityMetricSampleInput = {
  subsystemId: ReliabilitySubsystemId;
  key: ReliabilityStandardMetricKey;
  value: number | null;
  recordedAt?: ReliabilityIsoTimestamp;
  organizationId?: string | null;
};

export function buildReliabilityMetricSample(
  input: BuildReliabilityMetricSampleInput,
): ReliabilityMetricSample {
  return {
    subsystemId: input.subsystemId,
    key: input.key,
    value: normalizeMetricValue(input.key, input.value),
    unit: RELIABILITY_METRIC_UNITS[input.key],
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    organizationId: input.organizationId ?? null,
  };
}

export function buildStandardMetricSet(
  subsystemId: ReliabilitySubsystemId,
  values: Partial<Record<ReliabilityStandardMetricKey, number | null>>,
  recordedAt: ReliabilityIsoTimestamp = new Date().toISOString(),
): ReliabilityMetricSample[] {
  return RELIABILITY_STANDARD_METRIC_KEYS.map((key) =>
    buildReliabilityMetricSample({
      subsystemId,
      key,
      value: values[key] ?? null,
      recordedAt,
    }),
  );
}

export function isReliabilityStandardMetricKey(
  value: unknown,
): value is ReliabilityStandardMetricKey {
  return (
    typeof value === "string" &&
    (RELIABILITY_STANDARD_METRIC_KEYS as readonly string[]).includes(value)
  );
}

export function isReliabilityMetricSample(value: unknown): value is ReliabilityMetricSample {
  if (!value || typeof value !== "object") return false;
  const sample = value as ReliabilityMetricSample;
  return (
    typeof sample.subsystemId === "string" &&
    isReliabilityStandardMetricKey(sample.key) &&
    (sample.value === null || typeof sample.value === "number") &&
    typeof sample.unit === "string" &&
    typeof sample.recordedAt === "string"
  );
}

export function validateReliabilityMetricSample(
  sample: ReliabilityMetricSample,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (sample.unit !== RELIABILITY_METRIC_UNITS[sample.key]) {
    errors.push(`metric unit mismatch for ${sample.key}`);
  }
  if (sample.value != null && !Number.isFinite(sample.value)) {
    errors.push(`metric value must be finite or null for ${sample.key}`);
  }
  if (sample.value != null && isRatioMetric(sample.key) && (sample.value < 0 || sample.value > 1)) {
    errors.push(`ratio metric ${sample.key} must be between 0 and 1`);
  }
  if (sample.value != null && isCountMetric(sample.key) && sample.value < 0) {
    errors.push(`count metric ${sample.key} must be non-negative`);
  }
  return { valid: errors.length === 0, errors };
}

function normalizeMetricValue(
  key: ReliabilityStandardMetricKey,
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (isRatioMetric(key)) return Math.min(1, Math.max(0, value));
  if (isCountMetric(key)) return Math.max(0, Math.trunc(value));
  if (key === "processing_latency") return Math.max(0, value);
  return value;
}

function isRatioMetric(key: ReliabilityStandardMetricKey): boolean {
  return (
    key === "availability" ||
    key === "success_rate" ||
    key === "failure_rate" ||
    key === "retry_rate" ||
    key === "duplicate_rate" ||
    key === "false_positive_rate"
  );
}

function isCountMetric(key: ReliabilityStandardMetricKey): boolean {
  return key === "queue_depth" || key === "stuck_jobs";
}
