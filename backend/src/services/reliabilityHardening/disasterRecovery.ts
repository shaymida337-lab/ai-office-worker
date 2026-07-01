import type { DisasterRecoveryMetrics } from "./hardeningTypes.js";

export type DisasterRecoveryPlan = {
  databaseBackup: { enabled: boolean; frequency: string; retentionDays: number };
  restoreDrill: { frequency: string; lastDrillAt: string | null };
  replayIngestionEvents: boolean;
  regenerateDashboardState: boolean;
  recoverDriveMetadata: boolean;
  verifyOrgIsolationAfterRestore: boolean;
};

export const DISASTER_RECOVERY_PLAN: DisasterRecoveryPlan = {
  databaseBackup: { enabled: true, frequency: "daily", retentionDays: 30 },
  restoreDrill: { frequency: "monthly", lastDrillAt: null },
  replayIngestionEvents: true,
  regenerateDashboardState: true,
  recoverDriveMetadata: true,
  verifyOrgIsolationAfterRestore: true,
};

export type DisasterRecoveryDrillResult = {
  drillId: string;
  startedAt: string;
  completedAt: string | null;
  success: boolean;
  metrics: DisasterRecoveryMetrics;
  stepsCompleted: string[];
  failures: string[];
};

export function buildDisasterRecoveryDrillResult(input: {
  drillId: string;
  success: boolean;
  rpoMinutes?: number;
  rtoMinutes?: number;
  failures?: string[];
}): DisasterRecoveryDrillResult {
  return {
    drillId: input.drillId,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    success: input.success,
    metrics: {
      rpoMinutes: input.rpoMinutes ?? null,
      rtoMinutes: input.rtoMinutes ?? null,
      restoreSuccessRate: input.success ? 1 : 0,
      lastVerifiedRestoreAt: input.success ? new Date().toISOString() : null,
    },
    stepsCompleted: input.success
      ? [
          "database_restore",
          "replay_ingestion_events",
          "regenerate_dashboard",
          "recover_drive_metadata",
          "verify_org_isolation",
        ]
      : [],
    failures: input.failures ?? [],
  };
}

export function validateDisasterRecoveryReadiness(metrics: DisasterRecoveryMetrics): {
  ready: boolean;
  gaps: string[];
} {
  const gaps: string[] = [];
  if (metrics.lastVerifiedRestoreAt == null) gaps.push("no verified restore drill");
  if (metrics.rtoMinutes == null) gaps.push("RTO not measured");
  if (metrics.rpoMinutes == null) gaps.push("RPO not measured");
  if ((metrics.restoreSuccessRate ?? 0) < 1) gaps.push("restore success rate below 100%");
  return { ready: gaps.length === 0, gaps };
}
