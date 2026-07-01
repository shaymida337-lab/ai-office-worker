import type { DependencyHealthSnapshot, DependencyId } from "./hardeningTypes.js";
import { DEPENDENCY_IDS } from "./hardeningTypes.js";

export type DependencyHealthReport = {
  generatedAt: string;
  dependencies: DependencyHealthSnapshot[];
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  overallStatus: "healthy" | "degraded" | "unhealthy";
};

export function buildDependencyHealthSnapshot(
  dependencyId: DependencyId,
  input: Partial<Omit<DependencyHealthSnapshot, "dependencyId">> = {},
): DependencyHealthSnapshot {
  return {
    dependencyId,
    availability: input.availability ?? null,
    latencyMs: input.latencyMs ?? null,
    errorRate: input.errorRate ?? null,
    quotaUsage: input.quotaUsage ?? null,
    lastSuccessfulCallAt: input.lastSuccessfulCallAt ?? null,
    lastFailureAt: input.lastFailureAt ?? null,
    status: input.status ?? "unknown",
  };
}

export function buildDependencyHealthReport(
  snapshots: DependencyHealthSnapshot[],
): DependencyHealthReport {
  const healthyCount = snapshots.filter((s) => s.status === "healthy").length;
  const degradedCount = snapshots.filter((s) => s.status === "degraded").length;
  const unhealthyCount = snapshots.filter((s) => s.status === "unhealthy").length;

  let overallStatus: DependencyHealthReport["overallStatus"] = "healthy";
  if (unhealthyCount > 0) overallStatus = "unhealthy";
  else if (degradedCount > 0) overallStatus = "degraded";

  return {
    generatedAt: new Date().toISOString(),
    dependencies: snapshots,
    healthyCount,
    degradedCount,
    unhealthyCount,
    overallStatus,
  };
}

export function classifyDependencyHealthResult(
  report: DependencyHealthReport,
): "pass" | "warn" | "fail" {
  if (report.unhealthyCount > 0) return "fail";
  if (report.degradedCount > 0) return "warn";
  return "pass";
}

export function listTrackedDependencies(): DependencyId[] {
  return [...DEPENDENCY_IDS];
}

export function buildDefaultDependencyHealthReport(): DependencyHealthReport {
  return buildDependencyHealthReport(
    DEPENDENCY_IDS.map((id) => buildDependencyHealthSnapshot(id, { status: "unknown" })),
  );
}
