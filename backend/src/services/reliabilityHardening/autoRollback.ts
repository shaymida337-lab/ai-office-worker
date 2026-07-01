import type { RollbackTriggerKind } from "./hardeningTypes.js";
import { ROLLBACK_TRIGGER_KINDS } from "./hardeningTypes.js";

export type RollbackTriggerDefinition = {
  kind: RollbackTriggerKind;
  description: string;
  threshold: string;
  severity: "critical" | "warning";
  autoRollbackEnabled: boolean;
};

export const ROLLBACK_TRIGGER_CATALOG: readonly RollbackTriggerDefinition[] = [
  trigger("scanner_error_rate_spike", "Scanner error rate exceeds baseline", "> 5% for 15 min", "critical", true),
  trigger("extraction_success_rate_drop", "Claude extraction success rate drops", "< 90% for 15 min", "critical", true),
  trigger("amount_regression_detected", "Golden suite amount regression", "any critical case", "critical", true),
  trigger("duplicate_rate_spike", "Duplicate persistence rate spikes", "> 2x baseline", "critical", true),
  trigger("cross_org_anomaly", "Cross-org data anomaly detected", "any critical finding", "critical", true),
  trigger("payment_persistence_anomaly", "Unexpected payment persistence pattern", "integrity watch critical", "critical", true),
  trigger("critical_journey_failed", "Critical customer journey failed", "any critical journey", "critical", true),
  trigger("health_endpoint_failed", "Health endpoint unavailable", "3 consecutive failures", "critical", true),
  trigger("deployment_error_rate_exceeded", "Post-deploy error rate spike", "> 10% for 10 min", "critical", true),
];

function trigger(
  kind: RollbackTriggerKind,
  description: string,
  threshold: string,
  severity: "critical" | "warning",
  autoRollbackEnabled: boolean,
): RollbackTriggerDefinition {
  return { kind, description, threshold, severity, autoRollbackEnabled };
}

export type RollbackEvaluationInput = {
  triggeredKinds: RollbackTriggerKind[];
};

export function evaluateRollbackTriggers(input: RollbackEvaluationInput): {
  shouldRollback: boolean;
  triggered: RollbackTriggerDefinition[];
  explanation: string;
} {
  const triggered = ROLLBACK_TRIGGER_CATALOG.filter(
    (t) => input.triggeredKinds.includes(t.kind) && t.autoRollbackEnabled,
  );
  return {
    shouldRollback: triggered.length > 0,
    triggered,
    explanation:
      triggered.length > 0
        ? `Rollback triggered: ${triggered.map((t) => t.kind).join(", ")}`
        : "No rollback triggers active",
  };
}

export function listRollbackTriggers(): RollbackTriggerKind[] {
  return [...ROLLBACK_TRIGGER_KINDS];
}
