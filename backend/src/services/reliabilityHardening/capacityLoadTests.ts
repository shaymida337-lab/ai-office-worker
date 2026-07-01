export type LoadTestScenario = {
  scenarioId: string;
  description: string;
  parameters: Record<string, number | string>;
  safeThreshold: string;
  expectedBehavior: string;
};

export const CAPACITY_LOAD_TEST_SCENARIOS: readonly LoadTestScenario[] = [
  scenario("load-many-emails", "Burst of 500 emails in 10 minutes", { emailCount: 500, durationMinutes: 10 }, "queue depth < 200", "Graceful queueing, no data loss"),
  scenario("load-many-documents", "200 concurrent document processing", { documentCount: 200, concurrency: 20 }, "p95 latency < 60s", "Review routing on timeout"),
  scenario("load-many-orgs", "50 orgs scanning simultaneously", { orgCount: 50 }, "no cross-org leakage", "Org isolation maintained"),
  scenario("load-concurrent-scans", "10 scans per org concurrently", { scansPerOrg: 10, orgCount: 10 }, "no stuck scans > 30min", "Stale scan detection"),
  scenario("load-large-pdfs", "50MB PDF processing", { pdfSizeMb: 50, count: 10 }, "OCR completes or routes review", "No silent failure"),
  scenario("load-slow-apis", "Claude 30s latency injection", { latencyMs: 30000, requestCount: 50 }, "needs_review not auto_save", "Timeout → review"),
  scenario("load-queue-backlog", "1000 item backlog drain", { backlogSize: 1000 }, "drain within 4 hours", "No duplicate processing"),
];

function scenario(
  scenarioId: string,
  description: string,
  parameters: Record<string, number | string>,
  safeThreshold: string,
  expectedBehavior: string,
): LoadTestScenario {
  return { scenarioId, description, parameters, safeThreshold, expectedBehavior };
}

export function listLoadTestScenarios(): LoadTestScenario[] {
  return [...CAPACITY_LOAD_TEST_SCENARIOS];
}

export function evaluateLoadTestResult(input: {
  scenarioId: string;
  observedMetric: string;
  passed: boolean;
}): { scenarioId: string; passed: boolean; releaseImpact: "none" | "warn" | "block" } {
  return {
    scenarioId: input.scenarioId,
    passed: input.passed,
    releaseImpact: input.passed ? "none" : "warn",
  };
}
