import type { HardeningLayerDefinition } from "./hardeningTypes.js";
import { HARDENING_PLAN_VERSION } from "./hardeningTypes.js";

/**
 * Canonical registry of 17 reliability hardening layers.
 * Implementation order matches pre-launch roadmap.
 */
export const HARDENING_LAYER_REGISTRY: readonly HardeningLayerDefinition[] = [
  layer("data_integrity_watch", 1, "pre_launch_required", "Data Integrity Watch", "Recurring read-only integrity checks across payments, documents, org isolation, and dashboard consistency.", []),
  layer("audit_log", 2, "pre_launch_required", "Audit Log", "Immutable audit trail for sensitive financial and permission actions.", []),
  layer("permissions_rbac", 3, "pre_launch_required", "Permissions / RBAC", "Role-based access control — no financial action without permission check.", ["audit_log"]),
  layer("confidence_gates", 4, "pre_launch_required", "Confidence Gates", "AI confidence thresholds — auto_save only when sure; otherwise review or block.", ["permissions_rbac"]),
  layer("ai_auditor", 5, "pre_launch_required", "AI Auditor", "Second-pass review of Natalie decisions before persistence.", ["confidence_gates"]),
  layer("release_certificate", 6, "pre_launch_required", "Release Certificate", "Pre-deploy gate aggregating all reliability checks.", ["ai_auditor"]),
  layer("dependency_health", 7, "pre_launch_required", "Dependency Health", "External service health: Gmail, Drive, Claude, DB, Render, etc.", []),
  layer("configuration_validation", 8, "pre_launch_required", "Configuration Validation", "Startup and pre-deploy env/secret/feature-flag validation.", []),
  layer("shadow_mode", 9, "pre_launch_recommended", "Shadow Mode", "Parallel execution of risky changes; old path remains source of truth.", []),
  layer("canary_release", 10, "pre_launch_recommended", "Canary Release", "Staged rollout from internal org to full launch.", ["shadow_mode"]),
  layer("auto_rollback", 11, "pre_launch_recommended", "Auto Rollback", "Automatic rollback triggers on reliability regressions.", ["canary_release"]),
  layer("recovery_engine", 12, "pre_launch_recommended", "Recovery Engine", "Safe automatic recovery for low-risk operations only.", []),
  layer("disaster_recovery", 13, "pre_launch_recommended", "Disaster Recovery", "Backup, restore drills, RPO/RTO validation.", ["recovery_engine"]),
  layer("capacity_load_tests", 14, "post_launch", "Capacity / Load Tests", "Load testing for email volume, concurrent scans, large PDFs.", []),
  layer("stability_tests", 15, "post_launch", "Long-running Stability Tests", "Soak tests for memory, queues, token expiry, scheduled jobs.", []),
  layer("ai_model_drift", 16, "post_launch", "AI Model Drift Detection", "Monitor extraction quality trends vs baseline.", ["ai_auditor", "confidence_gates"]),
  layer("reliability_control_center", 17, "pre_launch_required", "Reliability Control Center", "Internal operator dashboard for Shay — all reliability layers in one view.", ["release_certificate", "dependency_health", "data_integrity_watch"]),
] as const;

function layer(
  layerId: HardeningLayerDefinition["layerId"],
  implementationOrder: number,
  phase: HardeningLayerDefinition["phase"],
  title: string,
  description: string,
  dependencies: HardeningLayerDefinition["dependencies"],
): HardeningLayerDefinition {
  return {
    layerId,
    version: HARDENING_PLAN_VERSION,
    title,
    description,
    implementationOrder,
    phase,
    status: "scaffolded",
    measurable: true,
    testable: true,
    explainable: true,
    recoverable: layerId === "recovery_engine" || layerId === "disaster_recovery" || layerId === "auto_rollback",
    permissionAware: layerId === "permissions_rbac" || layerId === "audit_log" || layerId === "reliability_control_center",
    safeByDefault: true,
    dependencies,
    tags: [phase, layerId],
  };
}

export function getHardeningLayer(layerId: HardeningLayerDefinition["layerId"]): HardeningLayerDefinition | undefined {
  return HARDENING_LAYER_REGISTRY.find((l) => l.layerId === layerId);
}

export function listPreLaunchRequiredLayers(): HardeningLayerDefinition[] {
  return HARDENING_LAYER_REGISTRY.filter((l) => l.phase === "pre_launch_required");
}

export function listPostLaunchLayers(): HardeningLayerDefinition[] {
  return HARDENING_LAYER_REGISTRY.filter((l) => l.phase === "post_launch");
}

export function listLayersByImplementationOrder(): HardeningLayerDefinition[] {
  return [...HARDENING_LAYER_REGISTRY].sort((a, b) => a.implementationOrder - b.implementationOrder);
}

export function validateHardeningRegistryIntegrity(): string[] {
  const errors: string[] = [];
  const orders = new Set<number>();
  for (const entry of HARDENING_LAYER_REGISTRY) {
    if (orders.has(entry.implementationOrder)) {
      errors.push(`duplicate implementation order: ${entry.implementationOrder}`);
    }
    orders.add(entry.implementationOrder);
    for (const dep of entry.dependencies) {
      const depLayer = getHardeningLayer(dep);
      if (!depLayer) {
        errors.push(`${entry.layerId} depends on unknown layer ${dep}`);
        continue;
      }
      if (depLayer.implementationOrder >= entry.implementationOrder) {
        errors.push(`${entry.layerId} depends on ${dep} which should be implemented first`);
      }
    }
  }
  if (HARDENING_LAYER_REGISTRY.length !== 17) {
    errors.push(`expected 17 layers, got ${HARDENING_LAYER_REGISTRY.length}`);
  }
  return errors;
}
