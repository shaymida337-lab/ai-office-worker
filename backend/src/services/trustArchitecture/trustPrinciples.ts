import type { NatalieTrustPrinciple, SafeFailureMode, UnsafeFailureMode } from "./trustTypes.js";
import { NATALIE_TRUST_PRINCIPLES, SAFE_FAILURE_MODES, UNSAFE_FAILURE_MODES } from "./trustTypes.js";

export type TrustPrincipleDefinition = {
  principle: NatalieTrustPrinciple;
  ruleNumber: number;
  title: string;
  description: string;
  requiredBehavior: string[];
  forbiddenBehavior: string[];
};

export const TRUST_PRINCIPLE_DEFINITIONS: readonly TrustPrincipleDefinition[] = [
  {
    principle: "never_guess",
    ruleNumber: 1,
    title: "Natalie never guesses",
    description: "If confidence is insufficient, stop, explain, request review. Never silently continue.",
    requiredBehavior: ["stop", "explain", "request_review", "emit_reliability_event"],
    forbiddenBehavior: ["silent_continue", "auto_save_on_low_confidence", "guess_amount", "guess_supplier"],
  },
  {
    principle: "explainable_financial_actions",
    ruleNumber: 2,
    title: "Every financial action must be explainable",
    description: "Every decision answers: why, what evidence, which rule, what confidence, what alternatives were rejected.",
    requiredBehavior: ["decision_evidence_object", "rule_reference", "confidence_score", "rejected_alternatives"],
    forbiddenBehavior: ["unexplained_persistence", "silent_auto_save"],
  },
  {
    principle: "reversible_financial_actions",
    ruleNumber: 3,
    title: "Every financial action must be reversible",
    description: "No destructive mutation without recovery path. Define rollback, replay, audit trail, recovery owner.",
    requiredBehavior: ["rollback_plan", "replay_path", "audit_trail", "recovery_owner"],
    forbiddenBehavior: ["destructive_mutation_without_audit", "hard_delete_without_approval"],
  },
  {
    principle: "measurable_decisions",
    ruleNumber: 4,
    title: "Every decision must be measurable",
    description: "Every subsystem publishes health, reliability, confidence, latency, error rate, auditability.",
    requiredBehavior: ["health_metrics", "reliability_events", "confidence_tracking", "latency_tracking"],
    forbiddenBehavior: ["unmeasured_subsystem_in_production"],
  },
  {
    principle: "fail_safely",
    ruleNumber: 5,
    title: "Every subsystem must fail safely",
    description: "Safe: needs_review, blocked, retry, queue, notification. Unsafe failures must never happen silently.",
    requiredBehavior: [...SAFE_FAILURE_MODES],
    forbiddenBehavior: [...UNSAFE_FAILURE_MODES],
  },
  {
    principle: "trust_requires_verification",
    ruleNumber: 6,
    title: "Trust requires verification",
    description: "Every important action independently verified by at least one additional mechanism.",
    requiredBehavior: [
      "golden_tests",
      "journey_tests",
      "ai_auditor",
      "integrity_watch",
      "audit_log",
    ],
    forbiddenBehavior: ["single_point_of_trust", "unverified_financial_persistence"],
  },
];

export function getTrustPrinciple(principle: NatalieTrustPrinciple): TrustPrincipleDefinition | undefined {
  return TRUST_PRINCIPLE_DEFINITIONS.find((p) => p.principle === principle);
}

export function listTrustPrinciples(): NatalieTrustPrinciple[] {
  return [...NATALIE_TRUST_PRINCIPLES];
}

export function isSafeFailureMode(mode: string): mode is SafeFailureMode {
  return (SAFE_FAILURE_MODES as readonly string[]).includes(mode);
}

export function isUnsafeFailureMode(mode: string): mode is UnsafeFailureMode {
  return (UNSAFE_FAILURE_MODES as readonly string[]).includes(mode);
}

export function assertPrincipleCompliance(input: {
  principle: NatalieTrustPrinciple;
  violations: string[];
}): { compliant: boolean; explanation: string } {
  const def = getTrustPrinciple(input.principle);
  if (!def) return { compliant: false, explanation: "unknown principle" };
  return {
    compliant: input.violations.length === 0,
    explanation:
      input.violations.length === 0
        ? `${def.title}: compliant`
        : `${def.title}: violations — ${input.violations.join("; ")}`,
  };
}
