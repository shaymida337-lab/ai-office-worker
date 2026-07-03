export type VoiceMetricsSnapshot = {
  at: number;
  sessionId: string;
  voiceTurns: number;
  confirmationRate: number;
  completionRate: number;
  executionRate: number;
  cancelledActions: number;
  averageLatencyMs: number;
  success: boolean;
};

const voiceTurnLatencies: number[] = [];
let voiceTurnCount = 0;
let confirmationPromptCount = 0;
let confirmationAcceptedCount = 0;
let confirmationRejectedCount = 0;
let confirmationCancelledCount = 0;
let executionSuccessCount = 0;
let executionFailureCount = 0;
const snapshots: VoiceMetricsSnapshot[] = [];
const MAX_SNAPSHOTS = 200;

export function resetVoiceMetrics() {
  voiceTurnLatencies.length = 0;
  voiceTurnCount = 0;
  confirmationPromptCount = 0;
  confirmationAcceptedCount = 0;
  confirmationRejectedCount = 0;
  confirmationCancelledCount = 0;
  executionSuccessCount = 0;
  executionFailureCount = 0;
  snapshots.length = 0;
}

export function getVoiceMetricsSnapshots(): VoiceMetricsSnapshot[] {
  return [...snapshots];
}

function averageLatency(): number {
  if (voiceTurnLatencies.length === 0) return 0;
  const total = voiceTurnLatencies.reduce((sum, value) => sum + value, 0);
  return Math.round(total / voiceTurnLatencies.length);
}

export function recordVoiceTurnMetric(input: {
  sessionId: string;
  latencyMs: number;
  confirmationRequired?: boolean;
  confirmationHandled?: "accepted" | "rejected" | "cancelled" | null;
  executed?: boolean;
  executionSucceeded?: boolean;
  success: boolean;
}) {
  voiceTurnCount += 1;
  voiceTurnLatencies.push(input.latencyMs);
  if (voiceTurnLatencies.length > 200) voiceTurnLatencies.shift();

  if (input.confirmationRequired) confirmationPromptCount += 1;
  if (input.confirmationHandled === "accepted") confirmationAcceptedCount += 1;
  if (input.confirmationHandled === "rejected") confirmationRejectedCount += 1;
  if (input.confirmationHandled === "cancelled") confirmationCancelledCount += 1;
  if (input.executed && input.executionSucceeded) executionSuccessCount += 1;
  if (input.executed && input.executionSucceeded === false) executionFailureCount += 1;

  const confirmationRate =
    confirmationPromptCount > 0 ? confirmationAcceptedCount / confirmationPromptCount : 0;
  const completionRate = voiceTurnCount > 0 ? (voiceTurnCount - executionFailureCount) / voiceTurnCount : 0;
  const executionRate =
    confirmationAcceptedCount > 0 ? executionSuccessCount / confirmationAcceptedCount : 0;

  snapshots.push({
    at: Date.now(),
    sessionId: input.sessionId,
    voiceTurns: voiceTurnCount,
    confirmationRate,
    completionRate,
    executionRate,
    cancelledActions: confirmationCancelledCount,
    averageLatencyMs: averageLatency(),
    success: input.success,
  });
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
}
