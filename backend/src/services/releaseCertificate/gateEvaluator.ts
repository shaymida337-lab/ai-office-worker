import type { ReleaseGateName, ReleaseGateResult, ReleaseGateStatus } from "./certificateTypes.js";

export function gateStatusToScore(status: ReleaseGateStatus): number {
  switch (status) {
    case "pass":
      return 100;
    case "warn":
      return 75;
    case "fail":
      return 0;
    case "not_run":
      return 50;
    default:
      return 0;
  }
}

export function buildGateResult(input: {
  name: ReleaseGateName;
  status: ReleaseGateStatus;
  evidence?: Record<string, unknown>;
  blockingReason?: string | null;
  critical?: boolean;
}): ReleaseGateResult {
  return {
    name: input.name,
    status: input.status,
    score: gateStatusToScore(input.status),
    critical: input.critical ?? input.name !== "reliability_foundation",
    evidence: input.evidence ?? {},
    blockingReason: input.blockingReason ?? (input.status === "fail" ? `${input.name} failed` : null),
  };
}

export function mapPassWarnFail(
  result: "pass" | "warn" | "fail" | "not_run",
): ReleaseGateStatus {
  return result;
}

export function deriveTrustScoreFromGates(gates: ReleaseGateResult[]): number {
  if (gates.length === 0) return 0;
  const sum = gates.reduce((acc, gate) => acc + gate.score, 0);
  return Math.round((sum / gates.length) * 10) / 10;
}
