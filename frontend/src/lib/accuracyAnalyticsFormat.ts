import type { AccuracyMetricTone } from "@/components/accuracy/AccuracyMetricCard";

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatConfidence(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

export function formatCountWithPercent(count: number, percent: number): string {
  return `${count.toLocaleString("he-IL")} (${formatPercent(percent, 0)})`;
}

export function formatIlsAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDurationMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

export function toneForHighIsGood(rate: number, goodAt = 80, warnAt = 60): AccuracyMetricTone {
  if (rate >= goodAt) return "good";
  if (rate >= warnAt) return "warn";
  return "bad";
}

export function toneForHighIsBad(rate: number, warnAt = 5, badAt = 15): AccuracyMetricTone {
  if (rate <= 0) return "good";
  if (rate < warnAt) return "neutral";
  if (rate < badAt) return "warn";
  return "bad";
}

export function toneForCount(count: number, warnAt = 1, badAt = 5): AccuracyMetricTone {
  if (count <= 0) return "good";
  if (count < badAt) return "warn";
  return "bad";
}
