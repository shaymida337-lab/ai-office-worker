import type { ConversationMetricsSnapshot } from "./conversationTypes.js";

const metrics: ConversationMetricsSnapshot[] = [];
const MAX_METRICS = 200;

export function resetConversationMetrics() {
  metrics.length = 0;
}

export function getConversationMetrics(): ConversationMetricsSnapshot[] {
  return [...metrics];
}

export function recordConversationMetric(snapshot: ConversationMetricsSnapshot) {
  metrics.push(snapshot);
  if (metrics.length > MAX_METRICS) metrics.shift();
}
